// keep track of the order that the logs come in
let order = 0;

/**
 * Gets the difference between two arrays
 *
 * @param array from
 * @param array to
 * @return mixed
 */
const getArrayDiff = (from, to) => {
  let result = [];
  for (const index in to) {
    const diff = getDiff(from[index], to[index]);
    if (diff !== undefined) {
      result.push(diff);
    }
  }

  if (result.length === 0) {
    return undefined;
  }

  return result;
};

/**
 * Gets the difference between two values
 *
 * @param mixed from
 * @param mixed to
 * @return mixed
 */
const getDiff = (from, to) => {
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
 *
 * @param object from
 * @param object to
 * @return mixed
 */
const getObjectDiff = (from, to) => {
  let result = {};
  for (const key in to) {
    const diff = getDiff(from[key], to[key]);
    if (diff !== undefined) {
      result[key] = diff;
    }
  }

  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result;
};

/**
 * Gets the current timestamp
 *
 * @return string
 */
const getTimestamp = () => {
  const pad = (value, number = 2) => ('' + value).padStart(number, '0');

  const time = new Date();
  const h = time.getHours();
  const m = time.getMinutes();
  const s = time.getSeconds();
  const ms = time.getMilliseconds();

  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
};

/**
 * Checks to see if the object is a plain old javascript object
 *
 * @param mixed maybeObject
 * @return bool
 */
const isPlainObject = (maybeObject) => {
  if (typeof maybeObject === 'object' && maybeObject !== null) {
    const prototype = Object.getPrototypeOf(maybeObject);
    return prototype === Object.prototype || prototype === null;
  }

  return false;
};

export default class EventLogger {
  /**
   * Creates a new EventLogger instance
   *
   * @param EventLogger parrentLogger
   * @param string event
   * @param number warningTimeout
   * @param array ...payload
   * @return EventLogger
   */
  constructor(parentLogger, event, warningTimeout, ...payload) {
    this.args = [event, '', ...payload, '', ++order, '', `${getTimestamp()}`];
    this.children = [];
    this.entries = [];
    this.parent = parentLogger;
    this.resolved = false;
    this.warningTimeout =
      parentLogger === null
        ? setTimeout(() => {
            console.warn(
              `The event '${event}' was dispatched, but it's taking a while ` +
                `to resolve.`,
            );
          }, warningTimeout)
        : null;

    // if another logger is unresolved, this logger is a child of it
    if (this.parent) {
      this.parent.addChild(this);
    }
  }

  /**
   * Adds a logger as a child
   *
   * @param EventLogger logger
   */
  addChild(logger) {
    this.children.push(logger);
  }

  /**
   * Adds a log entry
   *
   * @param string fn The name of the console method to call
   * @param array ...args The arguments to pass to the method call
   */
  addEntry(fn, ...args) {
    // we want to spice up the arguments for calls to groupCollapsed
    if (fn === 'groupCollapsed') {
      args = [...args, '', ++order, '', `${getTimestamp()}`];
    }

    this.entries.push({
      args: args,
      fn,
    });
  }

  /**
   * Checks to see if the given subject is in the logger tree
   *
   * @param EventLogger subject
   * @return bool
   */
  contains(subject) {
    if (subject === null) {
      return false;
    }

    for (let child of this.children) {
      if (child === subject) {
        return true;
      } else {
        return child.contains(subject);
      }
    }

    return false;
  }

  /**
   * Gets the top-most logger
   *
   * @return EventLogger
   */
  getTop() {
    if (this.parent) {
      return this.parent.getTop();
    }

    return this;
  }

  /**
   * Checks to see if the logger tree is resolved
   *
   * @return bool
   */
  isResolved() {
    if (!this.resolved) {
      return false;
    }

    for (let child of this.children) {
      if (!child.isResolved()) {
        return false;
      }
    }

    return true;
  }

  /**
   * Logs the logger tree
   */
  log() {
    console.groupCollapsed(...this.args);
    for (let child of this.children) {
      child.log();
    }

    for (let entry of this.entries) {
      console[entry.fn](...entry.args);
    }

    console.groupEnd();
  }

  /**
   * Adds entries that will log the difference between the two objects
   *
   * @param string namespace
   * @param object from
   * @param object to
   */
  logDiff(namespace, from, to) {
    this.addEntry(
      'groupCollapsed',
      `Changes for ${namespace}`,
      getDiff(from, to),
    );
    this.addEntry('log', 'Old State', from);
    this.addEntry('log', 'New State', to);
    this.addEntry('groupEnd');
  }

  /**
   * Adds entries that will log the state with a message of Error Reducing
   *
   * @param object state
   */
  logErrorReducing(namespace, state) {
    this.logState(`Error reducing for ${namespace}`, state);
  }

  /**
   * Adds entries that will log the state with a message of Error Reducing
   *
   * @param object state
   */
  logErrorRunningSideEffects(namespace, state) {
    this.logState(`Error running side-effects for ${namespace}`, state);
  }

  /**
   * Adds entries that will log the state with a message of No Changes
   *
   * @param object state
   */
  logNoChanges(namespace, state) {
    this.logState(`No changes for ${namespace}`, state);
  }

  /**
   * Adds entries that will log the state with a message of No Reducers
   *
   * @param object state
   */
  logNoReducers(namespace, state) {
    if (namespace) {
      this.logState(`No reducers for ${namespace}`, state);
    } else {
      this.logState('No reducers', state);
    }
  }

  /**
   * Adds entries that will log the state with a message
   *
   * @param string message
   * @param object state
   */
  logState(message, state) {
    this.addEntry('groupCollapsed', message);
    this.addEntry('log', 'Current State', state);
    this.addEntry('groupEnd');
  }

  /**
   * Resolves this logger
   * If all of the loggers in the tree are resolved, they will be logged
   */
  resolve() {
    this.resolved = true;

    let top = this.getTop();
    if (top.isResolved()) {
      clearTimeout(top.warningTimeout);
      top.log();
    }
  }
}
