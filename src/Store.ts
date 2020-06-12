import { Map } from 'immutable';

import stateManager, { UnknownObject } from './stateManager';

type DispatchCallback = (event: string, ...payload: unknown[]) => Promise<void>;
type Reducer = (state: State) => State;
type Selector<T = unknown> = (state: State, ...args: unknown[]) => T;
type SideEffect = {
  promise: Promise<Reducer | void>;
  store: Store;
};
type SideEffectRunner = (
  dispatch: DispatchCallback,
  ...payload: unknown[]
) => Promise<Reducer | void> | Reducer | void;
type State<T = unknown> = Map<string, T>;
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
function getState(
  namespace: string,
  selectors: {
    [property: string]: Selector;
  },
  getStateFn: 'selectState' | 'useState',
): State;
function getState<T = unknown>(
  namespace: string,
  selectors: {
    [property: string]: Selector;
  },
  getStateFn: 'selectState' | 'useState',
  property: string,
  ...args: unknown[]
): T | undefined;
function getState<T = unknown>(
  namespace: string,
  selectors: {
    [property: string]: Selector;
  },
  getStateFn: 'selectState' | 'useState',
  property?: string,
  ...args: unknown[]
): State | T | undefined {
  let state: State;
  if (getStateFn === 'selectState') {
    state = stateManager.selectState<State>(namespace);
  } else if (getStateFn === 'useState') {
    state = stateManager.useState<State>(namespace)[0];
  }

  if (property && selectors[property]) {
    return (selectors[property] as Selector<T>)(state!, ...args);
  } else {
    // if no property is set, just return the state
    if (property === undefined) {
      return state!;
    }

    return (state! as State<T>).get<T | undefined>(property, undefined);
  }
}

export default class Store {
  namespace: string;
  selectors: {
    [property: string]: Selector;
  };
  sideEffectRunnerKey: number;
  sideEffectRunners: {
    [event: string]: {
      [sideEffectRunnerKey: number]: SideEffectRunner;
    };
  };

  /**
   * Initializes a new Store
   */
  constructor(namespace: string, initialState: UnknownObject) {
    // set the initial state for the store
    stateManager.setState(namespace, Map(initialState));

    this.namespace = namespace;

    this.selectors = {};
    this.sideEffectRunnerKey = 0;
    this.sideEffectRunners = {};
  }

  /**
   * Adds a selector to normalize the data that is being selected
   */
  addSelector(property: string, selector: Selector): void {
    assertPropertyFormat(property);
    this.selectors[property] = selector;
  }

  /**
   * Uses the given reducer to reduce the state
   */
  reduce(reducer: Reducer): [boolean, State, State] {
    const oldState = stateManager.selectState(this.namespace) as State;
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
  register(
    event: string,
    sideEffectRunner: SideEffectRunner,
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
  selectState(): State;
  selectState<T = unknown>(property: string, ...args: unknown[]): T | undefined;
  selectState<T = unknown>(
    property?: string,
    ...args: unknown[]
  ): State | T | undefined {
    if (property === undefined) {
      return getState(this.namespace, this.selectors, 'selectState');
    } else {
      return getState<T>(
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
  useState(): State;
  useState<T = unknown>(property: string, ...args: unknown[]): T | undefined;
  useState<T = unknown>(
    property?: string,
    ...args: unknown[]
  ): State | T | undefined {
    if (property === undefined) {
      return getState(this.namespace, this.selectors, 'useState');
    } else {
      return getState<T>(
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
  State,
  UnregisterCallback,
};
