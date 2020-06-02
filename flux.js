import { fromJS, is, isImmutable, Map } from 'immutable';
import { useEffect, useRef } from 'react';

import global from './global';
import EventLogger from './EventLogger';
import Store from './Store';

let fluxIsReducing = null;

// the options for the system
let options = {
  displayLogs: true,
  longDispatchTimeout: 5000,
};

// store management
let stores = {};

/**
 * Adds a store to the system
 *
 * @param string namespace
 * @param object initialState
 */
const addStore = (namespace, initialState) => {
  if (namespace.indexOf('.') !== -1 || namespace.indexOf('/') !== -1) {
    throw new Error(`Store names cannot contain a period or forward-slash.`);
  }

  // always override with the latest store (to make fast-refresh work)
  return (stores[namespace] = new Store(namespace, initialState));
};

/**
 * Makes sure the event is formatted correctly
 *
 * @param string event
 */
const assertEventFormat = (event) => {
  if (event.indexOf('/') === -1) {
    throw new Error(
      `Events must be formatted like: 'namespace/event'. Received: '${event}'.`,
    );
  }
};

/**
 * Dispatch the flux/error event
 *
 * @param string event
 * @param Error err
 * @param array ...payload
 */
const dispatchError = (event, err, ...payload) => {
  // wrap in a timeout so the error will be logged after the current event
  setTimeout(
    () => dispatchWhenAllowed(null, 'flux/error', event, err, ...payload),
    0,
  );
};

/**
 * Dispatched the event immediately
 *
 * @param EventLogger parentLogger
 * @param string event
 * @param array ...payload
 * @return Promise
 */
const dispatchImmediately = (parentLogger, event, ...payload) => {
  const promise = new Promise(async (resolve) => {
    setEventStatus(event, 'dispatching', true);
    setEventStatus(event, 'error', null);
    setEventStatus(event, 'payload', payload);

    let logger;
    if (options.displayLogs) {
      logger = new EventLogger(
        parentLogger,
        event,
        options.longDispatchTimeout,
        ...payload,
      );
    }

    // start running side-effects
    let lastStore = null;
    try {
      let sideEffects = [];
      for (const namespace in stores) {
        const store = stores[namespace];
        lastStore = store;

        // we create a dispatch function that side-effects can use
        // this ensures that the logging hierarchy is setup correctly
        const dispatch = (event, ...payload) =>
          dispatchWhenAllowed(logger, event, ...payload);

        // collect all of the side effects that the store started
        sideEffects = sideEffects.concat(
          store.startSideEffects(dispatch, event, ...payload),
        );
      }

      // we need to keep track of which store goes with which reducer
      // the following code is basically Promise.all
      const reducers = await new Promise((resolve, reject) => {
        let result = [];
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
      });

      // start reducing
      try {
        fluxIsReducing = promise;

        // loop through the reducers one at a time and reduce the state
        let reducerCount = 0;
        for (const { reducer, store } of reducers) {
          if (reducer === null || reducer === undefined) {
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
            logger.logDiff(store.namespace, toJS(oldState), toJS(newState));
          } else if (logger) {
            logger.logNoChanges(store.namespace, toJS(oldState));
          }
        }

        if (logger && reducerCount === 0) {
          const store = stores[getEventNamespace(event)];
          if (store) {
            logger.logNoReducers(store.namespace, toJS(store.selectState()));
          } else {
            logger.logNoReducers(undefined, undefined);
          }
        }
      } catch (err) {
        if (logger) {
          logger.logErrorReducing(
            lastStore.namespace,
            toJS(lastStore.selectState()),
          );
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
      if (logger) {
        logger.logErrorRunningSideEffects(
          lastStore.namespace,
          toJS(lastStore.selectState()),
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
 * Dispatches the event unless one is currently dispatching,
 * in which case, it queues the dispatch to take place next
 *
 * @param EventLogger parentLogger
 * @param string event
 * @param array ...payload
 * @return Promise
 */
const dispatchWhenAllowed = async (parentLogger, event, ...payload) => {
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
 *
 * @param string event
 * @return string
 */
const getEventNamespace = (event) => {
  assertEventFormat(event);
  return event.split('/')[0];
};

/**
 * Gets the event status from the global state
 *
 * @param string getStateFn ['selectState', 'useState']
 * @param string event
 * @return mixed
 */
const getEventStatus = (getStateFn, event) => {
  assertEventFormat(event);

  let state;
  if (getStateFn === 'selectState') {
    state = global.selectState(event);
  } else if (getStateFn === 'useState') {
    state = global.useState(event)[0];
  }

  state = (state && state.toJS()) || {
    dispatching: false,
    error: null,
    payload: [],
  };

  return state;
};

/**
 * Checks to see if the given store has been added
 *
 * @param string namespace
 * @return bool
 */
const isStoreAdded = (namespace) => stores[namespace] !== undefined;

/**
 * Accesses the status of the event
 * This method call does not register for updates so the value could be stale
 *
 * @param string event
 * @return mixed
 */
const selectStatus = (event) => getEventStatus('selectState', event);

/**
 * Sets the event status in the global state
 *
 * @param string event
 * @param string property
 * @param mixed value
 */
const setEventStatus = (event, property, value) => {
  assertEventFormat(event);

  global.setState(
    event,
    (global.selectState(event) || Map()).set(property, value),
  );
};

/**
 * Sets the option to the specified value
 *
 * @param string option
 * @param bool value
 */
const setOption = (option, value) => (options[option] = value);

/**
 * Makes sure the passed object gets returned as a pure JS object
 *
 * @param mixed maybeImmutable
 * @return mixed
 */
const toJS = (maybeImmutable) => {
  if (isImmutable(maybeImmutable)) {
    return maybeImmutable.toJS();
  }

  return maybeImmutable;
};

/**
 * Accesses the status of the event
 * This method call registers for updates so the value is always up-to-date
 *
 * @param string event
 * @return mixed
 */
const useStatus = (event) => getEventStatus('useState', event);

/**
 * Setups up a store from within a component
 *
 * @param string namespace
 * @param object initialState {property: value}
 * @param object sideEffectRunners {event: sideEffect}
 * @return object
 */
const useStore = (namespace, initialState, sideEffectRunners) => {
  // only call addStore if the store hasn't been previously added
  // this makes fast refresh work with useStore
  if (!isStoreAdded(namespace)) {
    addStore(namespace, initialState);
  }

  // we will pass a ref containing sideEffectRunners into useEffect
  // to prevent re-rendering every time the state changes
  // if the sideEffectRunners change though, it will re-render
  const ref = useRef(sideEffectRunners);
  if (!is(fromJS(sideEffectRunners), fromJS(ref.current))) {
    ref.current = sideEffectRunners;
  }

  // wrap our registration in a useEffect so when the component unmounts,
  // we won't have any memory leaks
  useEffect(() => {
    const sideEffectRunners = ref.current;
    let unregisters = [];
    for (const event in sideEffectRunners) {
      unregisters.push(
        stores[namespace].register(
          `${namespace}/${event}`,
          sideEffectRunners[event],
        ),
      );
    }

    return () => unregisters.forEach((unregister) => unregister());
  }, [namespace, ref]);

  // use useState to register this hook to update on state changes
  let result = {};
  const state = stores[namespace].useState();
  for (const property in initialState) {
    result[property] = state.get(property, undefined);
  }

  return result;
};

const getPropertyDescriptor = (value) => ({ value });
export default Object.create(stores, {
  addStore: getPropertyDescriptor(addStore),
  dispatch: getPropertyDescriptor((event, ...payload) =>
    dispatchWhenAllowed(null, event, ...payload),
  ),
  selectStatus: getPropertyDescriptor(selectStatus),
  setOption: getPropertyDescriptor(setOption),
  useStatus: getPropertyDescriptor(useStatus),
  useStore: getPropertyDescriptor(useStore),
});
