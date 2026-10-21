-- Separate AI credential and durable caps. No raw IP, brief or page content is stored.
create table expanse_private.ai_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  key_hash text not null default '',
  daily_limit integer not null default 100 check(daily_limit between 1 and 1000)
);
insert into expanse_private.ai_config default values;
create table expanse_private.ai_usage (
  bucket timestamptz not null,
  visitor text not null,
  requests integer not null default 0 check(requests>=0),
  primary key(bucket,visitor)
);
alter table expanse_private.ai_config enable row level security;
alter table expanse_private.ai_usage enable row level security;
revoke all on expanse_private.ai_config,expanse_private.ai_usage from public,anon,authenticated;

