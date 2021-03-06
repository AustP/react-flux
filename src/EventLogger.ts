type ArrayDiff = { additions?: unknown[]; subtractions?: unknown[] };
type Entry = {
  args: unknown[];
  fn: string;
};
type ObjectDiff =
  | {
      additions: UnknownObject;
      changes?: UnknownObject;
      subtractions?: UnknownObject;
    }
  | {
      additions?: UnknownObject;
      changes?: UnknownObject;
      subtractions: UnknownObject;
    };
type UnknownObject = { [key: string]: unknown };

// keep track of the order that the logs come in
let order = 0;

/**
 * Gets the difference between two arrays
 */
const getArrayDiff = (
  from: unknown[],
  to: unknown[],
): ArrayDiff | unknown[] | undefined => {
  const result: ArrayDiff = {
    additions: [],
    subtractions: [],
  };

  if (from.length > to.length) {
    for (const index in from) {
      if (from.hasOwnProperty(index)) {
        if (to.hasOwnProperty(index)) {
          const diff = getDiff(from[index], to[index]);
          if (diff !== undefined) {
            result.additions!.push(to[index]);
            result.subtractions!.push(from[index]);
          }
        } else {
          result.subtractions!.push(from[index]);
        }
      }
    }
  } else {
    for (const index in to) {
      if (to.hasOwnProperty(index)) {
        if (from.hasOwnProperty(index)) {
          const diff = getDiff(from[index], to[index]);
          if (diff !== undefined) {
            result.additions!.push(to[index]);
            result.subtractions!.push(from[index]);
          }
        } else {
          result.additions!.push(to[index]);
        }
      }
    }
  }

  if (result.additions!.length === 0) {
    delete result.additions;
  }

  if (result.subtractions!.length === 0) {
    if (result.additions) {
      return result.additions;
    } else {
      return undefined;
    }
  }

  return result;
};

/**
 * Gets the difference between two values
 */
const getDiff = (from: any, to: any): any => {
  if (isPlainObject(from) && isPlainObject(to)) {
    return getObjectDiff(from, to);
  } else if (Array.isArray(from) && Array.isArray(to)) {
    return getArrayDiff(from, to);
  } else if (!Object.is(from, to)) {
    return to;
  }

  return undefined;
};

/**
 * Gets the difference between two objects
 */
const getObjectDiff = (
  from: UnknownObject,
  to: UnknownObject,
): ObjectDiff | UnknownObject | undefined => {
  const result: ObjectDiff = {
    additions: {},
    changes: {},
    subtractions: {},
  };

  for (const key in from) {
    if (from.hasOwnProperty(key)) {
      if (to.hasOwnProperty(key)) {
        const diff = getDiff(from[key], to[key]);
        if (diff !== undefined) {
          result.changes![key] = diff;
        }
      } else {
        result.subtractions![key] = from[key];
      }
    }
  }

  for (const key in to) {
    if (to.hasOwnProperty(key) && !from.hasOwnProperty(key)) {
      result.additions![key] = to[key];
    }
  }

  if (Object.keys(result.additions!).length === 0) {
    delete result.additions;
  }

  if (Object.keys(result.changes!).length === 0) {
    delete result.changes;
  }

  if (Object.keys(result.subtractions!).length === 0) {
    if (result.changes && !result.additions) {
      return result.changes;
    } else {
      delete result.subtractions;
    }
  }

  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result;
};

/**
 * Gets the current timestamp
 */
const getTimestamp = (): string => {
  const pad = (value: number, length: number = 2): string =>
    ('' + value).padStart(length, '0');

  const time = new Date();
  const h = time.getHours();
  const m = time.getMinutes();
  const s = time.getSeconds();
  const ms = time.getMilliseconds();

  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
};

/**
 * Checks to see if the object is a plain old javascript object
 */
const isPlainObject = (maybeObject: any): boolean => {
  if (typeof maybeObject === 'object' && maybeObject !== null) {
    const prototype = Object.getPrototypeOf(maybeObject);
    return prototype === Object.prototype || prototype === null;
  }

  return false;
};

export default class EventLogger {
  args: unknown[];
  children: EventLogger[];
  entries: Entry[];
  parent: EventLogger | null;
  resolved: boolean;
  warningTimeout: number | undefined;

  /**
   * Creates a new EventLogger instance
   */
  constructor(
    parentLogger: EventLogger | null,
    event: string,
    warningTimeout: number,
    ...payload: unknown[]
  ) {
    this.args = [event, '', ...payload, '', ++order, '', getTimestamp()];
    this.children = [];
    this.entries = [];
    this.parent = parentLogger;
    this.resolved = false;
    this.warningTimeout =
      parentLogger === null
        ? window.setTimeout(() => {
            // tslint:disable-next-line no-console
            console.warn(
              `The event '${event}' was dispatched, but it's taking a while ` +
                `to resolve.`,
            );
          }, warningTimeout)
        : undefined;

    if (this.parent) {
      this.parent.addChild(this);
    }
  }

  /**
   * Adds a logger as a child
   */
  addChild(logger: EventLogger): void {
    this.children.push(logger);
  }

  /**
   * Adds a log entry
   */
  addEntry(fn: string, ...args: unknown[]): void {
    // we want to spice up the arguments for calls to groupCollapsed
    if (fn === 'groupCollapsed') {
      args = [...args, '', ++order, '', getTimestamp()];
    }

    this.entries.push({
      args,
      fn,
    });
  }

  /**
   * Gets the top-most logger
   */
  getTop(): EventLogger {
    if (this.parent) {
      return this.parent.getTop();
    }

    return this;
  }

  /**
   * Checks to see if the logger tree is resolved
   */
  isResolved(): boolean {
    if (!this.resolved) {
      return false;
    }

    for (const child of this.children) {
      if (!child.isResolved()) {
        return false;
      }
    }

    return true;
  }

  /**
   * Logs the logger tree
   */
  log(): void {
    // although this.args is unknown[], we will rely on default toString
    // methods to log whatever the user supplies to us
    // tslint:disable-next-line no-console
    console.groupCollapsed(...(this.args as string[]));
    for (const child of this.children) {
      child.log();
    }

    for (const entry of this.entries) {
      console[entry.fn as keyof typeof console](...entry.args);
    }

    // tslint:disable-next-line no-console
    console.groupEnd();
  }

  /**
   * Adds entries that will log the difference between the two objects
   */
  logDiff(namespace: string, from?: object, to?: object): void {
    const diff = getDiff(from, to);
    if (diff === undefined) {
      return this.logNoChanges(namespace, from);
    }

    this.addEntry('groupCollapsed', `Changes for ${namespace}`, diff);
    this.addEntry('log', 'Old State', from);
    this.addEntry('log', 'New State', to);
    this.addEntry('groupEnd');
  }

  /**
   * Adds entries that will log the state with a message of Error Reducing
   */
  logErrorReducing(namespace: string, state?: object): void {
    this.logState(`Error reducing for ${namespace}`, state);
  }

  /**
   * Adds entries that will log the state with a message of Error Reducing
   */
  logErrorRunningSideEffects(namespace: string, state?: object): void {
    this.logState(`Error running side-effects for ${namespace}`, state);
  }

  /**
   * Adds entries that will log the state with a message of No Changes
   */
  logNoChanges(namespace: string, state?: object): void {
    this.logState(`No changes for ${namespace}`, state);
  }

  /**
   * Adds entries that will log the state with a message of No Reducers
   */
  logNoReducers(namespace?: string, state?: object): void {
    if (namespace) {
      this.logState(`No reducers for ${namespace}`, state);
    } else {
      this.logState('No reducers', state);
    }
  }

  /**
   * Adds entries that will log the state with a message
   */
  logState(message: string, state?: object): void {
    this.addEntry('groupCollapsed', message);
    this.addEntry('log', 'Current State', state);
    this.addEntry('groupEnd');
  }

  /**
   * Resolves this logger. If all of the loggers in the tree are resolved, they
   * will be logged
   */
  resolve(): void {
    this.resolved = true;

    const top = this.getTop();
    if (top.isResolved()) {
      clearTimeout(top.warningTimeout);
      top.log();
    }
  }
}
