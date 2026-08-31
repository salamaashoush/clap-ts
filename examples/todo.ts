/**
 * A todo list, kept in a JSON file beside the binary.
 *
 * Written against clap-ts's surface: subcommands with aliases, a required
 * positional, typed options with defaults, an enum with allowed values, a
 * repeated option, one backed by an environment variable, and a
 * comma-delimited list.
 */
import { defineCommand, runMain } from '../src/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

interface Todo {
  readonly id: number;
  readonly text: string;
  readonly done: boolean;
  readonly priority: string;
  readonly tags: string[];
  readonly due: string;
}

/**
 * `ctx.args` is a record of parsed values, so each is narrowed where it is
 * read. A value the parser produced for a declared arg always has the type its
 * definition asked for; these say so once rather than at every use.
 */
type ArgValue = string | number | boolean | string[] | undefined;

function asString(v: ArgValue, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function asNumber(v: ArgValue, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

function asBool(v: ArgValue): boolean {
  return v === true;
}

function asList(v: ArgValue): string[] {
  if (Array.isArray(v)) {
    return v;
  }
  return typeof v === 'string' ? [v] : [];
}

const FILE = process.env['TODO_FILE'] ?? '.todos.json';

function load(): Todo[] {
  if (!existsSync(FILE)) {
    return [];
  }
  const raw: unknown = JSON.parse(readFileSync(FILE, 'utf8'));
  const out: Todo[] = [];
  if (!Array.isArray(raw)) {
    return out;
  }
  for (const row of raw) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    const rec = row as Record<string, unknown>;
    const id = rec['id'];
    const text = rec['text'];
    const done = rec['done'];
    const priority = rec['priority'];
    const due = rec['due'];
    const tags: string[] = [];
    const rawTags = rec['tags'];
    if (Array.isArray(rawTags)) {
      for (const t of rawTags) {
        if (typeof t === 'string') {
          tags.push(t);
        }
      }
    }
    if (typeof id === 'number' && typeof text === 'string') {
      out.push({
        id,
        text,
        done: typeof done === 'boolean' ? done : false,
        priority: typeof priority === 'string' ? priority : 'normal',
        tags,
        due: typeof due === 'string' ? due : '',
      });
    }
  }
  return out;
}

function save(todos: readonly Todo[]): void {
  writeFileSync(FILE, `${JSON.stringify(todos)}\n`);
}

function nextId(todos: readonly Todo[]): number {
  let max = 0;
  for (const t of todos) {
    if (t.id > max) {
      max = t.id;
    }
  }
  return max + 1;
}

/** `#3 write it (high) [work,soon] due Friday` */
function render(t: Todo): string {
  const box = t.done ? '[x]' : '[ ]';
  const tags = t.tags.length > 0 ? ` [${t.tags.join(',')}]` : '';
  const due = t.due === '' ? '' : ` due ${t.due}`;
  return `${box} #${t.id} ${t.text} (${t.priority})${tags}${due}`;
}

const add = defineCommand({
  meta: { name: 'add', description: 'Add a todo' },
  args: {
    text: { type: 'positional', description: 'What to do', required: true },
    priority: {
      type: 'enum',
      short: 'p',
      description: 'How urgent it is',
      valueParser: ['low', 'normal', 'high'],
      default: 'normal',
    },
    tag: {
      type: 'string',
      short: 't',
      action: 'append',
      description: 'Tag the todo; repeat for several',
    },
    due: {
      type: 'string',
      short: 'd',
      env: 'TODO_DUE',
      description: 'When it is due',
    },
  },
  run(ctx) {
    const todos = load();
    const item: Todo = {
      id: nextId(todos),
      text: asString(ctx.args.text, ''),
      done: false,
      priority: asString(ctx.args.priority, 'normal'),
      tags: asList(ctx.args.tag),
      due: asString(ctx.args.due, ''),
    };
    save([...todos, item]);
    console.log(`added ${render(item)}`);
  },
});

const list = defineCommand({
  meta: { name: 'list', description: 'List todos', aliases: ['ls'] },
  args: {
    all: { type: 'boolean', short: 'a', description: 'Include finished todos' },
    limit: {
      type: 'number',
      short: 'n',
      description: 'Show at most this many',
      default: 100,
    },
    tag: {
      type: 'string',
      short: 't',
      valueDelimiter: ',',
      description: 'Only todos carrying one of these tags',
    },
    verbose: {
      type: 'boolean',
      short: 'v',
      action: 'count',
      description: 'Say more; repeat for more still',
    },
    done: {
      type: 'boolean',
      description: 'Only finished todos',
      conflictsWith: ['all'],
    },
  },
  run(ctx) {
    const todos = load();
    const wanted = asList(ctx.args.tag);
    const limit = asNumber(ctx.args.limit, 100);
    const loud = asNumber(ctx.args.verbose, 0);
    const onlyDone = asBool(ctx.args.done);
    if (loud > 0) {
      console.error(`reading ${FILE}`);
    }
    if (loud > 1) {
      console.error(`${todos.length} todo(s) on file`);
    }
    let shown = 0;
    for (const t of todos) {
      if (onlyDone && !t.done) {
        continue;
      }
      if (!onlyDone && t.done && !asBool(ctx.args.all)) {
        continue;
      }
      if (wanted.length > 0) {
        let hit = false;
        for (const w of wanted) {
          if (t.tags.includes(w)) {
            hit = true;
          }
        }
        if (!hit) {
          continue;
        }
      }
      if (shown >= limit) {
        break;
      }
      console.log(render(t));
      shown++;
    }
    if (shown === 0) {
      console.log('nothing to do');
    }
  },
});

const done = defineCommand({
  meta: { name: 'done', description: 'Mark a todo finished' },
  args: {
    id: { type: 'number', description: 'Which todo', required: true },
  },
  run(ctx) {
    const todos = load();
    const want = asNumber(ctx.args.id, -1);
    const out: Todo[] = [];
    let hit = false;
    for (const t of todos) {
      if (t.id === want) {
        hit = true;
        out.push({
          id: t.id,
          text: t.text,
          done: true,
          priority: t.priority,
          tags: t.tags,
          due: t.due,
        });
      } else {
        out.push(t);
      }
    }
    if (!hit) {
      console.error(`no todo #${want}`);
      process.exitCode = 1;
      return;
    }
    save(out);
    console.log(`done #${want}`);
  },
});

/** `todo tag add <id> <tag>` and `todo tag clear <id>`: nested subcommands. */
const tagAdd = defineCommand({
  meta: { name: 'add', description: 'Attach a tag to a todo' },
  args: {
    id: { type: 'number', description: 'Which todo', required: true },
    name: { type: 'positional', description: 'The tag', required: true },
  },
  run(ctx) {
    const want = asNumber(ctx.args.id, -1);
    const name = asString(ctx.args.name, '');
    const out: Todo[] = [];
    let hit = false;
    for (const t of load()) {
      if (t.id === want && !t.tags.includes(name)) {
        hit = true;
        out.push({
          id: t.id,
          text: t.text,
          done: t.done,
          priority: t.priority,
          tags: [...t.tags, name],
          due: t.due,
        });
      } else {
        if (t.id === want) {
          hit = true;
        }
        out.push(t);
      }
    }
    if (!hit) {
      console.error(`no todo #${want}`);
      process.exitCode = 1;
      return;
    }
    save(out);
    console.log(`tagged #${want} ${name}`);
  },
});

const tag = defineCommand({
  meta: { name: 'tag', description: 'Work with tags' },
  subCommands: { add: tagAdd },
});

const main = defineCommand({
  meta: { name: 'todo', version: '1.0.0', description: 'A small todo list' },
  subCommands: { add, list, done, tag },
});

await runMain(main);
