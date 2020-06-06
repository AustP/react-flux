import { Map } from 'immutable';

import stateManager, { UnknownObject } from './stateManager';

type AccessedState = State | unknown;
type DispatchCallback = (event: string, ...payload: unknown[]) => Promise<void>;
type Reducer = (state: State) => State;
type Selector = (state: State, ...args: unknown[]) => unknown;
type SideEffect = {
  promise: Promise<Reducer | void>;
  store: Store;
};
type SideEffectRunner = (
  dispatch: DispatchCallback,
  ...payload: unknown[]
) => Promise<Reducer> | Promise<void> | Reducer | void;
type State = Map<string, unknown>;
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
const getState = (
  namespace: string,
  selectors: {
    [property: string]: Selector;
  },
  getStateFn: 'selectState' | 'useState',
  property?: string,
  ...args: unknown[]
): AccessedState => {
  let state: State | undefined;
  if (getStateFn === 'selectState') {
    state = stateManager.selectState(namespace) as State;
  } else if (getStateFn === 'useState') {
    state = stateManager.useState(namespace)[0] as State;
  }

  if (property && selectors[property]) {
    return selectors[property](state as State, ...args);
  } else {
    // if no property is set, just return the state
    if (property === undefined) {
      return state;
    }

    return (state as State).get(property, undefined);
  }
};

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
   *
   * @param string namespace
   * @param object initialState
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
   * Registers the given side-effect runner for the specified event
   * Returns a function that can be used to unregister
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
   * Accesses the state specified by the given property
   * This method call does not register for updates so the value could be stale
   */
  selectState(property?: string, ...args: unknown[]): AccessedState {
    return getState(
      this.namespace,
      this.selectors,
      'selectState',
      property,
      ...args,
    );
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
   * Accesses the state specified by the given property
   * This method call registers for updates so the value is always up-to-date
   */
  useState(property?: string, ...args: unknown[]): AccessedState {
    return getState(
      this.namespace,
      this.selectors,
      'useState',
      property,
      ...args,
    );
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
