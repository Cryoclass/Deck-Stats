import type { FastifyInstance } from 'fastify';
import { resolveSession } from './session.js';

/**
 * Garde d'authentification (audit 04 O1). Elle se décide sur la ROUTE RÉSOLUE par Fastify,
 * jamais sur une chaîne : l'ancienne comparaison de `req.url` (chemin brut) se contournait par
 * `/%61pi/…`, que le routeur décode en `/api/…`. Une route est publique si et seulement si elle
 * le déclare (`config: { public: true }`) ; toute route sans cette marque exige une session —
 * une route ajoutée plus tard et oubliée est fermée, pas ouverte.
 */
declare module 'fastify' {
  interface FastifyContextConfig {
    /** Servie sans session (health, inscription, connexion, OAuth). Défaut : privée. */
    public?: boolean;
  }
}

export function registerAuthGuard(app: FastifyInstance): void {
  // Déclarée AVANT les routes : un hook Fastify ne s'applique qu'aux routes enregistrées après lui.
  app.addHook('preHandler', async (req, reply) => {
    // Aucune route résolue (`url` absent) = gestionnaire 404 de Fastify, qui traverse aussi les
    // hooks : repli SPA (index.html) ou 404 JSON, jamais une donnée. Il reste joignable.
    if (req.routeOptions.url === undefined) return;
    if (req.routeOptions.config.public === true) return;
    const user = await resolveSession(req, reply);
    if (!user) return reply.code(401).send({ error: 'non authentifié' });
    req.user = user;
  });
}

/** Marque publiques toutes les routes déclarées APRÈS cet appel dans le contexte d'`app` (front
 *  statique : il porte la page de connexion). Un hook onRoute ne voit pas les routes antérieures. */
export function markRoutesPublic(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    route.config = { ...route.config, public: true };
  });
}
