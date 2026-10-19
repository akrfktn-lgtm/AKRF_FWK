alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles
set role = case role
  when 'awam' then 'rancangan'
  when 'admin' then 'developer'
  else role
end
where role in ('awam', 'admin');

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('rancangan', 'juri', 'super_user', 'developer')) not valid;
