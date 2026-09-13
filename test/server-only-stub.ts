/**
 * `server-only` exists to blow up if a server module is pulled into a client
 * bundle. Vitest is neither, and the real package refuses to resolve outside
 * React's "react-server" condition, so tests alias it here. Nothing to
 * export — importing it is the whole point.
 */
export {};
