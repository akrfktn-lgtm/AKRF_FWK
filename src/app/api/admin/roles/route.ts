import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { normalizeProfileRole, type ProfileRole } from "../../../../lib/supabase";

export const runtime = "nodejs";

type ProfileRow = { id: string; full_name: string; role: string };

const ALLOWED_ROLES: ProfileRole[] = ["rancangan", "juri", "super_user", "developer"];

function getConfiguration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return null;
  return { supabaseUrl, anonKey, serviceRoleKey };
}

function getMissingConfiguration() {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

function configurationError() {
  const missing = getMissingConfiguration();
  return NextResponse.json({
    error: `Konfigurasi server belum lengkap. Tetapkan pemboleh ubah berikut pada environment server: ${missing.join(", ")}. Kemudian restart atau deploy semula aplikasi.`,
  }, { status: 503 });
}

async function authorizeDeveloper(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const configuration = getConfiguration();
  if (!token || !configuration) return null;

  const userClient = createClient(configuration.supabaseUrl, configuration.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return null;

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();
  if (profileError || normalizeProfileRole(profile.role) !== "developer") return null;

  const adminClient = createClient(configuration.supabaseUrl, configuration.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: authData.user.id, adminClient };
}

export async function GET(request: Request) {
  const configuration = getConfiguration();
  if (!configuration) return configurationError();
  const authorization = await authorizeDeveloper(request);
  if (!authorization) return NextResponse.json({ error: "Developer access is required." }, { status: 403 });

  const users: { id: string; email: string; full_name: string; role: ProfileRole }[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await authorization.adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      return NextResponse.json({ error: `Unable to load users: ${error.message}` }, { status: 500 });
    }
    users.push(...data.users.map((user) => ({
      id: user.id,
      email: user.email ?? "",
      full_name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
      role: "rancangan" as ProfileRole,
    })));
    if (data.users.length < 1000) break;
  }

  for (let index = 0; index < users.length; index += 500) {
    const userIds = users.slice(index, index + 500).map((user) => user.id);
    if (!userIds.length) continue;
    const { data: profiles, error } = await authorization.adminClient
      .from("profiles")
      .select("id, full_name, role")
      .in("id", userIds);
    if (error) {
      return NextResponse.json({ error: `Unable to load user roles: ${error.message}` }, { status: 500 });
    }
    const profilesById = new Map((profiles as ProfileRow[]).map((profile) => [profile.id, profile]));
    for (const user of users.slice(index, index + 500)) {
      const profile = profilesById.get(user.id);
      if (!profile) {
        return NextResponse.json({ error: `No profile is available for user ${user.id}.` }, { status: 500 });
      }
      const role = normalizeProfileRole(profile.role);
      if (!role) {
        return NextResponse.json({ error: `User ${user.id} has an unsupported role.` }, { status: 500 });
      }
      user.full_name = profile.full_name || user.full_name;
      user.role = role;
    }
  }

  return NextResponse.json(
    { users, currentUserId: authorization.userId },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request) {
  const configuration = getConfiguration();
  if (!configuration) return configurationError();
  const authorization = await authorizeDeveloper(request);
  if (!authorization) return NextResponse.json({ error: "Developer access is required." }, { status: 403 });

  let body: { userId?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  if (typeof body.userId !== "string" || !ALLOWED_ROLES.includes(body.role as ProfileRole)) {
    return NextResponse.json({ error: "A valid user ID and role are required." }, { status: 400 });
  }
  if (body.userId === authorization.userId) {
    return NextResponse.json({ error: "You cannot change your own role." }, { status: 400 });
  }

  const role = body.role as ProfileRole;
  const { data: profile, error: updateError } = await authorization.adminClient
    .from("profiles")
    .update({ role })
    .eq("id", body.userId)
    .select("id, full_name, role")
    .maybeSingle();
  if (updateError) {
    return NextResponse.json({ error: `Unable to update user role: ${updateError.message}` }, { status: 500 });
  }
  if (!profile) return NextResponse.json({ error: "The user profile was not found." }, { status: 404 });

  return NextResponse.json({ user: profile });
}
