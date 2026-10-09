// Recent players (Phase 7 Step 5; docs/MULTIPLAYER.md): the last people a signed-in player raced with (mp_race_players)
// or met in a free-roam challenge (roam_challenge_players), newest first — each once, their public name, when, where
// (the race's venue, or free roam) and where the two stand as friends, for the multiplayer menu's "Add friend". Never a
// player either of them has blocked, never a guest (they can't be friends) and never an NPC (not a player at all).
//
//   await recentPlayers(db, userId, { limit })  → [{ id, name, at, where, friend: 'friend' | 'outgoing' | 'incoming' | 'none' }]

import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';

const LIMIT = 20, DAYS = 30;

export async function recentPlayers(db: Db, userId: string, { limit = LIMIT, days = DAYS }: { limit?: number; days?: number } = {}) {
  // (the rows met: each race and challenge of theirs in the last month, the others in it; newest meeting per player)
  const rows = (await db.execute(sql`
    with met as (
      select o.user_id as id, r.created_at as at, r.venue as venue, 'race' as kind from mp_race_players me
        join mp_race_players o on o.race_id = me.race_id and o.user_id <> me.user_id
        join mp_races r on r.id = me.race_id
        where me.user_id = ${userId} and r.created_at > now() - make_interval(days => ${days})
      union all
      select o.user_id, c.created_at, null::jsonb, 'roam' from roam_challenge_players me
        join roam_challenge_players o on o.challenge_id = me.challenge_id and o.user_id <> me.user_id
        join roam_challenges c on c.id = me.challenge_id
        where me.user_id = ${userId} and c.created_at > now() - make_interval(days => ${days})
    ), latest as (select distinct on (id) id, at, venue, kind from met order by id, at desc)
    select l.id, u.name, l.at, l.kind, l.venue,
      case when l.venue->>'kind' = 'route' then (select data->>'name' from content_items where id = l.venue->>'id' and kind = 'route' and view = 'published')
           when l.venue->>'kind' = 'track' then (select info->>'name' from track_courses where code = l.venue->>'code') end as venue_name,
      f.status, f.requested_by
    from latest l join users u on u.id = l.id
    left join friendships f on (f.a_id = ${userId} and f.b_id = l.id) or (f.a_id = l.id and f.b_id = ${userId})
    where not u.is_anonymous and not coalesce(u.banned, false)
      and not exists (select 1 from blocks b where (b.user_id = ${userId} and b.blocked_id = l.id) or (b.user_id = l.id and b.blocked_id = ${userId}))
    order by l.at desc limit ${limit}`)).rows as any[];
  return rows.map(r => ({
    id: r.id as string, name: r.name as string, at: new Date(r.at).toISOString(),
    where: r.kind === 'roam' ? 'free roam' : (r.venue_name ?? (r.venue?.kind === 'track' ? 'a generated track' : 'a race')) as string,
    friend: !r.status ? 'none' : r.status === 'accepted' ? 'friend' : r.requested_by === userId ? 'outgoing' : 'incoming',
  }));
}
