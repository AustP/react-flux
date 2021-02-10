import { useEffect, useLayoutEffect, useRef } from 'react';

import stateManager, { State } from './stateManager';
import EventLogger from './EventLogger';
import Store, {
  DispatchCallback,
  Reducer,
  SideEffect,
  SideEffectRunner,
  UnregisterCallback,
} from './Store';

type EventObject = {
  dispatched: boolean;
  dispatching: boolean;
  error: Error | null;
  payload: unknown[];
};
type ResolvedSideEffect<T extends State> = {
  reducer: Reducer<T> | EventObject | void;
  store: Store<T>;
};
type SideEffectRunnerObject<T extends State> = {
  [event: string]: SideEffectRunner<T>;
};

let fluxIsReducing: Promise<EventObject> | null = null;

// the options for the system
const options = {
  displayLogs: true,
  longDispatchTimeout: 5000,
};

// store management
const stores: {
  [namespace: string]: Store<any>;
} = {};

/**
 * Adds a store to the system
 */
const addStore = <T extends State>(
  namespace: string,
  initialState: T,
): Store<T> => {
  if (namespace.indexOf('.') !== -1 || namespace.indexOf('/') !== -1) {
    throw new Error(`Store names cannot contain a period or forward-slash.`);
  }

  // always override with the latest store (to make fast-refresh work)
  return (stores[namespace] = new Store<T>(namespace, initialState));
};

/**
 * Makes sure the event is formatted correctly
 */
const assertEventFormat = (event: string): void => {
  if (event.indexOf('/') === -1) {
    throw new Error(
      `Events must be formatted like: 'namespace/event'. Received: '${event}'.`,
    );
  }
};

/**
 * Dispatch the flux/error event
 */
const dispatchError = (
  event: string,
  error: Error,
  ...payload: unknown[]
): Promise<void> =>
  new Promise((resolve) => {
    // wrap in a timeout so the error will be logged after the current event
    window.setTimeout(async () => {
      await dispatchWhenAllowed(null, 'flux/error', event, error, ...payload);
      setEventStatus('flux/error', { error });
      resolve();
    }, 0);
  });

/**
 * Dispatched the event immediately
 */
const dispatchImmediately = (
  parentLogger: EventLogger | null,
  event: string,
  ...payload: unknown[]
): Promise<EventObject> => {
  const promise = new Promise<EventObject>(async (resolve) => {
    setEventStatus(event, {
      dispatched: false,
      dispatching: true,
      error: null,
      payload,
    });

    let logger: EventLogger | null = null;
    if (options.displayLogs) {
      logger = new EventLogger(
        parentLogger,
        event,
        options.longDispatchTimeout,
        ...payload,
      );
    }

    // start running side-effects
    let lastStore: null | Store<State> = null;
    try {
      let sideEffects: SideEffect<State>[] = [];
      for (const namespace in stores) {
        if (stores.hasOwnProperty(namespace)) {
          const store = stores[namespace];
          lastStore = store;

          // we create a dispatch function that side-effects can use
          // this ensures that the logging hierarchy is setup correctly
          const dispatch: DispatchCallback = (event, ...payload) =>
            dispatchWhenAllowed(logger, event, ...payload);

          // collect all of the side effects that the store started
          sideEffects = sideEffects.concat(
            store.startSideEffects(dispatch, event, ...payload),
          );
        }
      }

      // we need to keep track of which store goes with which reducer
      // the following code is basically Promise.all
      const reducers = await new Promise<ResolvedSideEffect<State>[]>(
        (resolve, reject) => {
          const result: ResolvedSideEffect<State>[] = [];
          let remaining = sideEffects.length;
          if (remaining === 0) {
            resolve(result);
          }

          sideEffects.forEach(({ promise, store }, index) =>
            promise
              .then((reducer) => {
                if (isEventObject(reducer)) {
                  reducer = undefined;
                }

                result[index] = { reducer, store };
                if (--remaining === 0) {
                  resolve(result);
                }
              })
              .catch(reject),
          );
        },
      );

      // start reducing
      try {
        fluxIsReducing = promise;

        // loop through the reducers one at a time and reduce the state
        let reducerCount = 0;
        for (const { reducer, store } of reducers) {
          if (reducer === undefined) {
            continue;
          } else if (typeof reducer !== 'function') {
            throw new Error(`Invalid reducer returned for '${event}'.`);
          } else if (!store) {
            throw new Error(`No store available to reduce for '${event}'.`);
          }

          reducerCount++;
          lastStore = store;

          const [oldState, newState] = store.reduce(reducer);
          if (logger) {
            logger.logDiff(store.namespace, oldState, newState);
          }
        }

        if (logger && reducerCount === 0) {
          const store = stores[getEventNamespace(event)];
          if (store) {
            logger.logNoReducers(store.namespace, store.selectState());
          } else {
            logger.logNoReducers(undefined, undefined);
          }
        }
      } catch (error) {
        if (logger && lastStore) {
          logger.logErrorReducing(lastStore.namespace, lastStore.selectState());
        }

        error = errorfy(error);
        setEventStatus(event, { error });

        // there was an error, dispatch an error event about it
        // and update the event status to include the error
        if (event !== 'flux/error') {
          setEventStatus(event, { error });
          dispatchError(event, error, ...payload);
        }
      }

      fluxIsReducing = null;
    } catch (error) {
      if (logger && lastStore) {
        logger.logErrorRunningSideEffects(
          lastStore.namespace,
          lastStore.selectState(),
        );
      }

      error = errorfy(error);
      setEventStatus(event, { error });

      // there was an error, dispatch an error event about it
      // and update the event status to include the error
      if (event !== 'flux/error') {
        setEventStatus(event, { error });
        dispatchError(event, error, ...payload);
      }
    }

    if (logger) {
      logger.resolve();
    }

    setEventStatus(event, { dispatched: true, dispatching: false });
    // on the next tick, mark this event as no longer dispatched
    setTimeout(() => setEventStatus(event, { dispatched: false }), 0);

    resolve(selectEvent(event));
  });

  return promise;
};

/**
 * Dispatches the event unless one is currently dispatching, in which case, it
 * queues the dispatch to take place next
 */
const dispatchWhenAllowed = async (
  parentLogger: EventLogger | null,
  event: string,
  ...payload: unknown[]
): Promise<EventObject> => {
  // fluxIsReducing will either be a promise (so we can await it) or null
  // doing this allows us to piggy-back on JS' queue system
  if (fluxIsReducing) {
    parentLogger = null;
    await fluxIsReducing;
  }

  return dispatchImmediately(parentLogger, event, ...payload);
};

/**
 * Makes sure the given error is an Error object.
 */
const errorfy = (error: unknown): Error => {
  if (error && (error as any).message) {
    return error as Error;
  } else if (typeof error === 'string') {
    return new Error(error);
  } else {
    return new Error(JSON.stringify(error));
  }
};

/**
 * Checks if the supplied object is an event status object
 */
const isEventObject = (object: any): object is EventObject => {
  if (
    object &&
    'dispatched' in object &&
    'dispatching' in object &&
    'error' in object &&
    'payload' in object
  ) {
    return true;
  }

  return false;
};

/**
 * Gets the namespace from the specified event
 */
const getEventNamespace = (event: string): string => {
  assertEventFormat(event);
  return event.split('/')[0];
};

/**
 * Gets the event status from the state manager
 */
const getEventStatus = (
  getStateFn: 'selectState' | 'useState',
  event: string,
): EventObject => {
  assertEventFormat(event);

  let state: State | undefined;
  if (getStateFn === 'selectState') {
    state = stateManager.selectState<State | undefined>(event);
  } else if (getStateFn === 'useState') {
    state = stateManager.useState<State | undefined>(event)[0];
  }

  if (!state) {
    return {
      dispatched: false,
      dispatching: false,
      error: null,
      payload: [],
    };
  } else {
    return state as EventObject;
  }
};

/**
 * Checks to see if the given store has been added
 */
const isStoreAdded = (namespace: string): boolean =>
  stores[namespace] !== undefined;

/**
 * Accesses the status of the event. This method call does not register for
 * updates so the value could be stale
 */
const selectEvent = (event: string): EventObject =>
  getEventStatus('selectState', event);

/**
 * @deprecated
 * Use selectEvent instead.
 *
 * Accesses the status of the event. This method call does not register for
 * updates so the value could be stale
 */
const selectStatus = (event: string): EventObject => {
  // tslint:disable-next-line:no-console
  console.warn('selectStatus is deprecated. use selectEvent instead.');
  return selectEvent(event);
};

/**
 * Sets the event status in the state manager
 */
const setEventStatus = (event: string, state: {}): void => {
  assertEventFormat(event);

  let oldState = stateManager.selectState<State | undefined>(event);
  if (oldState === undefined) {
    oldState = {};
  }

  stateManager.setState(event, { ...oldState, ...state });
};

/**
 * Sets the option to the specified value
 */
const setOption = (
  option: 'displayLogs' | 'longDispatchTimeout',
  value: boolean | number,
): void => void ((options[option] as boolean | number) = value);

/**
 * Executes the side-effect whenever the given event is dispatched.
 * The side-effect is executed with the rest of the side-effects for the event
 */
const useDispatchedEvent = (
  event: string,
  sideEffect: (...payload: any[]) => Promise<void> | void,
  dependencies: any[] = [],
): void => {
  // keep the side-effects in a ref so we aren't constantly unregistering
  const ref = useDependentRef(sideEffect, dependencies);

  // wrap our register call in useEffect to prevent memory leaks
  useEffect(() => {
    const namespace = getEventNamespace(event);
    return stores[namespace].register(event, async (dispatch, ...payload) => {
      // we will await the call to the side-effect because we want this to be
      // blocking before state reductions take place
      // but we don't want to be able to change the store's state from the
      // side-effect so we purposefully don't return the result
      await ref.current(...payload);
    });
  }, [event, ref.current]);
};

/**
 * Creates a ref that updates whenever one of the dependencies changes
 */
const useDependentRef = <T>(
  value: T,
  dependencies: any[],
): React.MutableRefObject<T> => {
  // keep the side-effects in a ref so we aren't constantly unregistering
  const ref = useRef(value);
  useEffect(() => void (ref.current = value), dependencies);

  return ref;
};

/**
 * Executes the side-effect when the event resolves. i.e. finishes reducing
 */
const useResolvedEvent = (
  event: string,
  sideEffect: (status: EventObject) => void,
  dependencies: any[] = [],
) => {
  // keep the side-effects in a ref so we aren't constantly unregistering
  const ref = useDependentRef(sideEffect, dependencies);

  // wrap our call to the side-effect in a useEffect because we only want it
  // to be called once when the event is dispatched
  const { dispatched } = useEvent(event);
  useEffect(() => {
    if (dispatched) {
      ref.current(selectEvent(event));
    }
  }, [dispatched, event, ref.current]);
};

/**
 * Accesses the status of the event. This method call registers for updates so
 * the value is always up-to-date
 */
const useEvent = (event: string): EventObject =>
  getEventStatus('useState', event);

/**
 * @deprecated
 * Use useEvent instead.
 *
 * Accesses the status of the event. This method call registers for updates so
 * the value is always up-to-date
 */
const useStatus = (event: string): EventObject => {
  // tslint:disable-next-line:no-console
  console.warn('useStatus is deprecated. use useEvent instead.');
  return useEvent(event);
};

/**
 * Setups up a store from within a component
 */
const useStore = <T extends State>(
  namespace: string,
  initialState: T,
  sideEffectRunners: SideEffectRunnerObject<T>,
  dependencies: any[] = [],
): T => {
  // only call addStore if the store hasn't been previously added
  // this makes fast refresh work with useStore
  if (!isStoreAdded(namespace)) {
    addStore(namespace, initialState);
  }

  // keep the side-effect runners in a ref so we aren't constantly unregistering
  const ref = useDependentRef(sideEffectRunners, dependencies);

  // wrap our registration in a useLayoutEffect so when the component unmounts,
  // we won't have any memory leaks
  useLayoutEffect(() => {
    const unregisterCallbacks: UnregisterCallback[] = [];
    for (const event in ref.current) {
      if (ref.current.hasOwnProperty(event)) {
        unregisterCallbacks.push(
          stores[namespace].register(
            `${namespace}/${event}`,
            ref.current[event],
          ),
        );
      }
    }

    return () => unregisterCallbacks.forEach((unregister) => unregister());
  }, [namespace, ref.current]);

  // use useState to register this hook to update on state changes
  const state = stores[namespace].useState();
  const result: { [key: string]: any } = {};
  Object.keys(initialState).forEach((key) => {
    result[key] = state[key];
  });

  return Object.freeze(result) as T;
};

declare global {
  interface Flux {
    readonly [Symbol.iterator]: () => Iterator<Store<State>>;
    readonly addStore: typeof addStore;
    readonly dispatch: DispatchCallback;
    readonly selectEvent: typeof selectEvent;
    readonly selectStatus: typeof selectStatus;
    readonly setOption: typeof setOption;
    readonly useDispatchedEvent: typeof useDispatchedEvent;
    readonly useEvent: typeof useEvent;
    readonly useResolvedEvent: typeof useResolvedEvent;
    readonly useStatus: typeof useStatus;
    readonly useStore: typeof useStore;
  }
}

const getPropertyDescriptor = (value: any): any => ({ value });
export default Object.create(stores, {
  [Symbol.iterator]: getPropertyDescriptor(() =>
    Object.values(stores)[Symbol.iterator](),
  ),
  addStore: getPropertyDescriptor(addStore),
  dispatch: getPropertyDescriptor((event: string, ...payload: any[]) =>
    dispatchWhenAllowed(null, event, ...payload),
  ),
  selectEvent: getPropertyDescriptor(selectEvent),
  selectStatus: getPropertyDescriptor(selectStatus),
  setOption: getPropertyDescriptor(setOption),
  useDispatchedEvent: getPropertyDescriptor(useDispatchedEvent),
  useEvent: getPropertyDescriptor(useEvent),
  useResolvedEvent: getPropertyDescriptor(useResolvedEvent),
  useStatus: getPropertyDescriptor(useStatus),
  useStore: getPropertyDescriptor(useStore),
}) as Flux & {
  readonly [namespace: string]: Store<State> | undefined;
};

type StoreInterface<T extends State> = Store<T>;
export { Flux, EventObject, StoreInterface as Store };
