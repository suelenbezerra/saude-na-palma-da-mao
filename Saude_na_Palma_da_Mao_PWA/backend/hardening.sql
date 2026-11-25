-- Aplicado ao projeto gungfzwsltprcdvjgwap após a criação do banco com RLS automático.
-- A função de event trigger continua disponível ao proprietário; clientes da API não a executam.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
