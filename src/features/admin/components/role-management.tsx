"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, LoaderCircle, Save, Search, ShieldCheck } from "lucide-react";
import { supabase, type ProfileRole } from "../../../lib/supabase";

type ManagedUser = { id: string; email: string; full_name: string; role: ProfileRole };
type RoleFilter = "all" | ProfileRole;

const ROLE_DETAILS: { role: ProfileRole; label: string; access: string }[] = [
  { role: "rancangan", label: "Rancangan", access: "Akses penilaian Phase 1." },
  { role: "juri", label: "Juri", access: "Akses penilaian Phase 2 dan eksport laporan." },
  { role: "super_user", label: "Super User", access: "Akses penilaian Phase 2, eksport laporan, membuka kunci soalan dan membuka semula penghantaran." },
  { role: "developer", label: "Developer", access: "Pengurusan sistem serta akses penilaian Phase 1 dan Phase 2." },
];

const ROLE_LABELS = Object.fromEntries(ROLE_DETAILS.map(({ role, label }) => [role, label])) as Record<ProfileRole, string>;

async function requestRoleApi<T>(method: "GET" | "PATCH", body?: { userId: string; role: ProfileRole }): Promise<T> {
  if (!supabase) throw new Error("Sambungan Supabase belum dikonfigurasi.");
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error(error?.message ?? "Sesi pengguna telah tamat. Sila log masuk semula.");

  const response = await fetch("/api/admin/roles", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Permintaan pengurusan peranan gagal.");
  return result;
}

export function RoleManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [draftRoles, setDraftRoles] = useState<Record<string, ProfileRole>>({});
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage("");
    void requestRoleApi<{ users: ManagedUser[]; currentUserId: string }>("GET")
      .then(({ users: loadedUsers, currentUserId: activeUserId }) => {
        if (cancelled) return;
        setUsers(loadedUsers);
        setCurrentUserId(activeUserId);
        setDraftRoles(Object.fromEntries(loadedUsers.map((user) => [user.id, user.role])));
        setLoadFailed(false);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Tidak dapat memuatkan pengguna.");
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return users.filter((user) => {
      const matchesSearch = !normalizedSearch
        || user.full_name.toLocaleLowerCase().includes(normalizedSearch)
        || user.email.toLocaleLowerCase().includes(normalizedSearch);
      return matchesSearch && (roleFilter === "all" || user.role === roleFilter);
    });
  }, [roleFilter, search, users]);

  async function saveRole(user: ManagedUser) {
    const nextRole = draftRoles[user.id];
    if (!nextRole || nextRole === user.role) return;
    setSavingUserId(user.id);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await requestRoleApi<{ user: ManagedUser }>("PATCH", { userId: user.id, role: nextRole });
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...result.user } : item));
      setDraftRoles((current) => ({ ...current, [user.id]: result.user.role }));
      setSuccessMessage(`Peranan ${result.user.full_name || result.user.id} berjaya dikemas kini kepada ${ROLE_LABELS[result.user.role]}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Tidak dapat mengemas kini peranan.");
    } finally {
      setSavingUserId("");
    }
  }

  return <section className="role-management">
    <header className="role-management-heading">
      <div>
        <span className="form-step"><ShieldCheck size={14} /> PENGURUSAN AKSES</span>
        <h2>Pengurusan Peranan / Role Management</h2>
        <p>Tetapkan peranan dan kebenaran akses untuk setiap akaun pengguna.</p>
      </div>
      <span className="role-management-count">{loadFailed ? "Senarai tidak tersedia" : `${users.length} pengguna`}</span>
    </header>

    <div className="role-access-matrix" aria-label="Ringkasan akses mengikut peranan">
      {ROLE_DETAILS.map(({ role, label, access }) => <article className="role-access-card" key={role}>
        <span className={`role-badge role-badge-${role}`}>{label}</span>
        <p>{access}</p>
      </article>)}
    </div>

    <section className="panel role-users-panel">
      <div className="role-users-toolbar">
        <label className="role-search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Cari nama atau e-mel pengguna</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau e-mel pengguna..." />
        </label>
        <label className="role-filter-field">
          <span>Tapis peranan</span>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}>
            <option value="all">All Roles</option>
            {ROLE_DETAILS.map(({ role, label }) => <option key={role} value={role}>{label}</option>)}
          </select>
        </label>
      </div>

      {errorMessage && <p className="role-management-message role-management-error" role="alert">{errorMessage}</p>}
      {successMessage && <p className="role-management-message role-management-success" role="status"><CheckCircle2 size={16} />{successMessage}</p>}
      {isLoading ? <div className="role-management-loading"><LoaderCircle size={18} className="role-management-spinner" /> Memuatkan pengguna...</div>
        : loadFailed ? <div className="role-management-loading">
          <button className="button button-outline" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Cuba lagi</button>
        </div>
        : <div className="table-scroll">
          <table className="role-users-table">
            <thead><tr><th>Nama &amp; E-mel Pengguna</th><th>Peranan Semasa</th><th>Akses Kebenaran</th><th>Tukar Peranan</th><th>Action</th></tr></thead>
            <tbody>{filteredUsers.map((user) => {
              const selectedRole = draftRoles[user.id] ?? user.role;
              const isSaving = savingUserId === user.id;
              return <tr key={user.id}>
                <td><strong>{user.full_name || "Nama belum ditetapkan"}</strong><span>{user.email || "E-mel tidak tersedia"}</span></td>
                <td><span className={`role-badge role-badge-${user.role}`}>{ROLE_LABELS[user.role]}</span></td>
                <td>{ROLE_DETAILS.find(({ role }) => role === user.role)?.access}</td>
                <td><select aria-label={`Tukar peranan untuk ${user.full_name || user.email}`} title={user.id === currentUserId ? "Peranan akaun aktif tidak boleh ditukar di sini." : undefined} value={selectedRole} disabled={isSaving || user.id === currentUserId} onChange={(event) => setDraftRoles((current) => ({ ...current, [user.id]: event.target.value as ProfileRole }))}>
                  {ROLE_DETAILS.map(({ role, label }) => <option key={role} value={role}>{label}</option>)}
                </select></td>
                <td><button className="role-save-button" type="button" disabled={isSaving || user.id === currentUserId || selectedRole === user.role} onClick={() => void saveRole(user)}>
                  {isSaving ? <LoaderCircle size={15} className="role-management-spinner" /> : <Save size={15} />}
                  {isSaving ? "Menyimpan..." : "Simpan"}
                </button></td>
              </tr>;
            })}{!filteredUsers.length && <tr><td className="role-users-empty" colSpan={5}>{users.length ? "Tiada pengguna sepadan dengan carian atau tapisan ini." : "Tiada akaun pengguna ditemui."}</td></tr>}</tbody>
          </table>
        </div>}
      {!isLoading && !loadFailed && <footer className="role-users-footer">Memaparkan {filteredUsers.length} daripada {users.length} pengguna.</footer>}
    </section>
  </section>;
}
