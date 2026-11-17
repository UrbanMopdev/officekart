# Database migrations

Phase 1 (online multiplayer MVP) does not use PostgreSQL: guest racing runs
entirely in the game server's memory, and nothing is persisted.

Phase 3 adds persistent profiles, race results and leaderboards. Migrations
for those tables will live in this folder and run as a Railway pre-deploy
command on the game-server service.
