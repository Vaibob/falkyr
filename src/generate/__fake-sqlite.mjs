// A better-sqlite3-compatible shim backed by Node 24's built-in node:sqlite.
// Implements only the surface src/db/index.ts uses: default-export class with
// pragma(), exec(), prepare()->{run,get,all}, transaction(), and named/positional
// params. Used only in tests to avoid the native better-sqlite3 build.
import { DatabaseSync } from 'node:sqlite';

class BetterSqliteCompat {
  constructor(filename) {
    // ':memory:' keeps tests hermetic.
    this._db = new DatabaseSync(filename === undefined ? ':memory:' : filename);
  }
  pragma(_str) {
    // no-op for tests (journal_mode / foreign_keys not needed in-memory)
    return [];
  }
  exec(sql) {
    this._db.exec(sql);
    return this;
  }
  prepare(sql) {
    const stmt = this._db.prepare(sql);
    return {
      run: (...args) => {
        const info = stmt.run(...normalize(args));
        return {
          changes: Number(info.changes),
          lastInsertRowid: info.lastInsertRowid,
        };
      },
      get: (...args) => stmt.get(...normalize(args)),
      all: (...args) => stmt.all(...normalize(args)),
    };
  }
  transaction(fn) {
    // better-sqlite3 returns a callable that runs fn in a transaction.
    return (...args) => {
      this._db.exec('BEGIN');
      try {
        const r = fn(...args);
        this._db.exec('COMMIT');
        return r;
      } catch (e) {
        this._db.exec('ROLLBACK');
        throw e;
      }
    };
  }
  close() {
    this._db.close();
  }
}

// better-sqlite3 accepts a single object for @named params; node:sqlite expects
// that object passed positionally too, but keys must not be prefixed. Our SQL
// uses @name placeholders and passes a plain object — node:sqlite supports
// named params via a leading object with bare keys, which matches. Pass through.
function normalize(args) {
  return args;
}

export default BetterSqliteCompat;
