import stateManager, { State } from './stateManager';

type DispatchCallback = (event: string, ...payload: any[]) => Promise<void>;
type Reducer<T extends State = State> = (state: T) => State;
type Selector<S extends State, T = unknown> = (state: S, ...args: any[]) => T;
type SideEffect = {
  promise: Promise<Reducer | void>;
  store: Store;
};
type SideEffectRunner<T extends State = State> = (
  dispatch: DispatchCallback,
  ...payload: any[]
) => Promise<Reducer<T> | void> | Reducer<T> | void;
type UnregisterCallback = () => void;

/**
 * Makes sure the event is formatted correctly
 */
const assertEventFormat = (event: string) => {
  if (event.indexOf('/') === -1) {
    throw new Error(
      `Events must be formatted like: 'namespace/event'. Received: '${event}'.`,
    );
  }
};

/**
 * Makes sure the property is formatted correctly
 */
const assertPropertyFormat = (property: string) => {
  if (property.indexOf('.') !== -1) {
    throw new Error(
      `Store properties must be formatted like: 'property'. ` +
        `Received '${property}'.`,
    );
  }
};

/**
 * Gets the property value from the state
 */
function getState<S extends State>(
  namespace: string,
  selectors: {
    [property: string]: Selector<S>;
  },
  getStateFn: 'selectState' | 'useState',
): S;
function getState<S extends State, T = unknown>(
  namespace: string,
  selectors: {
    [property: string]: Selector<S>;
  },
  getStateFn: 'selectState' | 'useState',
  property: string,
  ...args: unknown[]
): T | undefined;
function getState<S extends State, T = unknown>(
  namespace: string,
  selectors: {
    [property: string]: Selector<S>;
  },
  getStateFn: 'selectState' | 'useState',
  property?: string,
  ...args: unknown[]
): S | T | undefined {
  let state: S;
  if (getStateFn === 'selectState') {
    state = stateManager.selectState<S>(namespace);
  } else if (getStateFn === 'useState') {
    state = stateManager.useState<S>(namespace)[0];
  }

  if (property && selectors[property]) {
    return (selectors[property] as Selector<S, T>)(state!, ...args);
  } else {
    // if no property is set, just return the state
    if (property === undefined) {
      return state!;
    }

    return state![property] as T | undefined;
  }
}

export default class Store<S extends State = State> {
  namespace: string;
  selectors: {
    [property: string]: Selector<any>;
  };
  sideEffectRunnerKey: number;
  sideEffectRunners: {
    [event: string]: {
      [sideEffectRunnerKey: number]: SideEffectRunner<any>;
    };
  };

  /**
   * Initializes a new Store
   */
  constructor(namespace: string, initialState: State) {
    // set the initial state for the store
    stateManager.setState(namespace, initialState);

    this.namespace = namespace;

    this.selectors = {};
    this.sideEffectRunnerKey = 0;
    this.sideEffectRunners = {};
  }

  /**
   * Adds a selector to normalize the data that is being selected
   */
  addSelector<T extends S = S>(property: string, selector: Selector<T>): void {
    assertPropertyFormat(property);
    this.selectors[property] = selector;
  }

  /**
   * Uses the given reducer to reduce the state
   */
  reduce(reducer: Reducer): [boolean, State, State] {
    const oldState = stateManager.selectState<State>(this.namespace);
    const newState = reducer(oldState);

    return [
      stateManager.setState(this.namespace, newState),
      oldState,
      newState,
    ];
  }

  /**
   * Registers the given side-effect runner for the specified event. Returns a
   * function that can be used to unregister
   */
  register<T extends S = S>(
    event: string,
    sideEffectRunner: SideEffectRunner<T>,
  ): UnregisterCallback {
    assertEventFormat(event);

    if (!this.sideEffectRunners[event]) {
      this.sideEffectRunners[event] = {};
    }

    const key = this.sideEffectRunnerKey++;
    this.sideEffectRunners[event][key] = sideEffectRunner;

    return function (this: Store): void {
      delete this.sideEffectRunners[event][key];
    }.bind(this);
  }

  /**
   * Accesses the state specified by the given property. This method call does
   * not register for updates
   */
  selectState<R extends S = S>(): R;
  selectState<T = unknown>(property: string, ...args: unknown[]): T | undefined;
  selectState<T = unknown>(
    property?: string,
    ...args: unknown[]
  ): S | T | undefined {
    if (property === undefined) {
      return getState<S>(this.namespace, this.selectors, 'selectState');
    } else {
      return getState<S, T>(
        this.namespace,
        this.selectors,
        'selectState',
        property,
        ...args,
      );
    }
  }

  /**
   * Starts the side effects for the given event
   */
  startSideEffects(
    dispatch: DispatchCallback,
    event: string,
    ...payload: unknown[]
  ): SideEffect[] {
    const sideEffects: SideEffect[] = [];
    for (const key in this.sideEffectRunners[event]) {
      if (this.sideEffectRunners[event].hasOwnProperty(key)) {
        sideEffects.push({
          promise: Promise.resolve(
            this.sideEffectRunners[event][key](dispatch, ...payload),
          ),
          store: this,
        });
      }
    }

    return sideEffects;
  }

  /**
   * Accesses the state specified by the given property. This method call
   * registers for updates so the value is always up-to-date
   */
  useState<R extends S = S>(): R;
  useState<T = unknown>(property: string, ...args: unknown[]): T | undefined;
  useState<T = unknown>(
    property?: string,
    ...args: unknown[]
  ): S | T | undefined {
    if (property === undefined) {
      return getState<S>(this.namespace, this.selectors, 'useState');
    } else {
      return getState<S, T>(
        this.namespace,
        this.selectors,
        'useState',
        property,
        ...args,
      );
    }
  }
}

export {
  DispatchCallback,
  Reducer,
  SideEffect,
  SideEffectRunner,
  UnregisterCallback,
};
