import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { Guards } from '../session.ts';
export async function trackRoutes(_app: FastifyInstance, _deps: { config: Config; db: Db; G: Guards }) {}
