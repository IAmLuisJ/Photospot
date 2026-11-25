-- Run read-only against the legacy database. Follow docs/CLOUDFLARE.md to set
-- umask 077 and create a private mktemp directory before redirecting output.
-- This export contains user email addresses, roles and moderation data.
SELECT jsonb_build_object(
  'users', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'name',coalesce(p.display_name,u.email),'email_verified',u.email_confirmed_at IS NOT NULL,'created_at',u.created_at)),'[]'::jsonb) FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id),
  'identities', (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'provider',provider,'provider_id',identity_data->>'sub')),'[]'::jsonb) FROM auth.identities),
  'shoot_types', (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.shoot_types t),
  'profiles', (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.profiles t),
  'spots', (SELECT coalesce(jsonb_agg((to_jsonb(s)-'location') || jsonb_build_object('lat',extensions.st_y(s.location::extensions.geometry),'lng',extensions.st_x(s.location::extensions.geometry))),'[]'::jsonb) FROM public.spots s),
  'spot_shoot_types', (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.spot_shoot_types t),
  'signals', (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.signals t),
  'photos', (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.photos t),
  'spot_gallery_links', (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.spot_gallery_links t),
  'comments', (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.comments t),
  'studio_details', (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.studio_details t),
  'reports', (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.reports t)
);
