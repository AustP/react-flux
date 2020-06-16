import areValuesEqual from 'fast-deep-equal';
import { useEffect, useRef } from 'react';

import stateManager, { State } from './stateManager';
import EventLogger from './EventLogger';
import Store, {
  DispatchCallback,
  Reducer,
  SideEffect,
  SideEffectRunner,
  UnregisterCallback,
} from './Store';

type ResolvedSideEffect = {
  reducer: Reducer | void;
  store: Store;
};
type SideEffectRunnerObject<T extends State = State> = {
  [event: string]: SideEffectRunner<T>;
};
type StatusObject = {
  dispatching: boolean;
  error: unknown;
  payload: unknown[];
};

let fluxIsReducing: Promise<void> | null = null;

// the options for the system
const options = {
  displayLogs: true,
  longDispatchTimeout: 5000,
};

// store management
const stores: {
  [namespace: string]: Store;
} = {};

/**
 * Adds a store to the system
 */
const addStore = <T extends State = State>(
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
  err: Error,
  ...payload: unknown[]
): Promise<void> =>
  new Promise((resolve) => {
    // wrap in a timeout so the error will be logged after the current event
    window.setTimeout(async () => {
      await dispatchWhenAllowed(null, 'flux/error', event, err, ...payload);
      setEventStatus('flux/error', 'error', err);
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
): Promise<void> => {
  const promise = new Promise<void>(async (resolve) => {
    setEventStatus(event, 'dispatching', true);
    setEventStatus(event, 'error', null);
    setEventStatus(event, 'payload', payload);

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
    let lastStore: null | Store = null;
    try {
      let sideEffects: SideEffect[] = [];
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
      const reducers = await new Promise<ResolvedSideEffect[]>(
        (resolve, reject) => {
          const result: ResolvedSideEffect[] = [];
          let remaining = sideEffects.length;
          if (remaining === 0) {
            resolve(result);
          }

          sideEffects.forEach(({ promise, store }, index) =>
            promise
              .then((reducer) => {
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

          const [updated, oldState, newState] = store.reduce(reducer);
          if (logger && updated) {
            logger.logDiff(store.namespace, oldState, newState);
          } else if (logger) {
            logger.logNoChanges(store.namespace, oldState);
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
      } catch (err) {
        if (logger && lastStore) {
          logger.logErrorReducing(lastStore.namespace, lastStore.selectState());
        }

        // there was an error, dispatch an error event about it
        // and update the event status to include the error
        if (event !== 'flux/error') {
          setEventStatus(event, 'error', err);
          dispatchError(event, err, ...payload);
        }
      }

      fluxIsReducing = null;
    } catch (err) {
      if (logger && lastStore) {
        logger.logErrorRunningSideEffects(
          lastStore.namespace,
          lastStore.selectState(),
        );
      }

      // there was an error, dispatch an error event about it
      // and update the event status to include the error
      if (event !== 'flux/error') {
        setEventStatus(event, 'error', err);
        dispatchError(event, err, ...payload);
      }
    }

    if (logger) {
      logger.resolve();
    }

    setEventStatus(event, 'dispatching', false);
    resolve();
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
): Promise<void> => {
  // fluxIsReducing will either be a promise (so we can await it) or null
  // doing this allows us to piggy-back on JS' queue system
  if (fluxIsReducing) {
    parentLogger = null;
    await fluxIsReducing;
  }

  return dispatchImmediately(parentLogger, event, ...payload);
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
): StatusObject => {
  assertEventFormat(event);

  let state: State | undefined;
  if (getStateFn === 'selectState') {
    state = stateManager.selectState<State | undefined>(event);
  } else if (getStateFn === 'useState') {
    state = stateManager.useState<State | undefined>(event)[0];
  }

  if (!state) {
    return {
      dispatching: false,
      error: null,
      payload: [],
    };
  } else {
    return state as StatusObject;
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
const selectStatus = (event: string): StatusObject =>
  getEventStatus('selectState', event);

/**
 * Sets the event status in the state manager
 */
const setEventStatus = (event: string, property: string, value: any): void => {
  assertEventFormat(event);

  let oldState = stateManager.selectState<State | undefined>(event);
  if (oldState === undefined) {
    oldState = {};
  }

  stateManager.setState(event, { ...oldState, [property]: value });
};

/**
 * Sets the option to the specified value
 */
const setOption = (
  option: 'displayLogs' | 'longDispatchTimeout',
  value: boolean | number,
): void => void ((options[option] as boolean | number) = value);

/**
 * Accesses the status of the event. This method call registers for updates so
 * the value is always up-to-date
 */
const useStatus = (event: string): StatusObject =>
  getEventStatus('useState', event);

/**
 * Setups up a store from within a component
 */
const useStore = <T extends State = State>(
  namespace: string,
  initialState: T,
  sideEffectRunners: SideEffectRunnerObject<T>,
): T => {
  // only call addStore if the store hasn't been previously added
  // this makes fast refresh work with useStore
  if (!isStoreAdded(namespace)) {
    addStore(namespace, initialState);
  }

  // we will pass a ref containing sideEffectRunners into useEffect
  // to prevent re-rendering every time the state changes
  // if the sideEffectRunners change though, it will re-render
  const ref = useRef(sideEffectRunners);
  if (!areValuesEqual(sideEffectRunners, ref.current)) {
    ref.current = sideEffectRunners;
  }

  // wrap our registration in a useEffect so when the component unmounts,
  // we won't have any memory leaks
  useEffect(() => {
    const sideEffectRunners = ref.current;
    const unregisterCallbacks: UnregisterCallback[] = [];
    for (const event in sideEffectRunners) {
      if (sideEffectRunners.hasOwnProperty(event)) {
        unregisterCallbacks.push(
          stores[namespace].register(
            `${namespace}/${event}`,
            sideEffectRunners[event],
          ),
        );
      }
    }

    return () => unregisterCallbacks.forEach((unregister) => unregister());
  }, [namespace, ref]);

  // use useState to register this hook to update on state changes
  const state = stores[namespace].useState();
  const result = Object.keys(initialState).reduce(
    (result, key) => ({ ...result, [key]: state[key] }),
    {},
  );

  // if they specify a return type, we will cast it to that
  return Object.freeze(result) as T;
};

const getPropertyDescriptor = (value: any): any => ({ value });
export default Object.create(stores, {
  [Symbol.iterator]: getPropertyDescriptor(() =>
    Object.values(stores)[Symbol.iterator](),
  ),
  addStore: getPropertyDescriptor(addStore),
  dispatch: getPropertyDescriptor((event: string, ...payload: any[]) =>
    dispatchWhenAllowed(null, event, ...payload),
  ),
  selectStatus: getPropertyDescriptor(selectStatus),
  setOption: getPropertyDescriptor(setOption),
  useStatus: getPropertyDescriptor(useStatus),
  useStore: getPropertyDescriptor(useStore),
}) as {
  readonly [Symbol.iterator]: () => Iterator<Store>;
  readonly addStore: typeof addStore;
  readonly dispatch: DispatchCallback;
  readonly selectStatus: typeof selectStatus;
  readonly setOption: typeof setOption;
  readonly useStatus: typeof useStatus;
  readonly useStore: typeof useStore;
} & {
  readonly [namespace: string]: Store | undefined;
};

type StoreInterface<T extends State = State> = Store<T>;
export { State, StoreInterface as Store };
