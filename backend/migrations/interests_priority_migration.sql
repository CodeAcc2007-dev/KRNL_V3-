-- Interest catalog: source of truth for extraction tags + the Settings dropdown.
create table if not exists interest_catalog (
    slug text primary key,
    label text not null,
    active boolean not null default true,
    sort_order integer not null default 0
);

insert into interest_catalog (slug, label, sort_order) values
    ('internships',        'Internships',          10),
    ('placements',         'Placements',           20),
    ('hackathons',         'Hackathons',           30),
    ('research-projects',  'Research & Projects',  40),
    ('competitions',       'Competitions',         50),
    ('cultural',           'Cultural',             60),
    ('sports',             'Sports',               70),
    ('workshops-talks',    'Workshops & Talks',    80),
    ('scholarships-funding','Scholarships & Funding',90),
    ('clubs-tech-teams',   'Clubs & Tech Teams',   100),
    ('entrepreneurship',   'Entrepreneurship',     110)
on conflict (slug) do nothing;

-- Per-email catalog slugs, written at extraction time.
alter table events add column if not exists interest_tags jsonb default '[]'::jsonb;

-- Per-user selected catalog slugs.
alter table profiles add column if not exists interest_slugs jsonb default '[]'::jsonb;
