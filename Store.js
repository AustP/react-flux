import { Map } from 'immutable';

import global from './global';

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
 * Makes sure the property is formatted correctly
 *
 * @param string property
 */
const assertPropertyFormat = (property) => {
  if (property.indexOf('.') !== -1) {
    throw new Error(
      `Store properties must be formatted like: 'property'. ` +
        `Received '${property}'.`,
    );
  }
};

/**
 * Gets the property value from the state
 *
 * @param string namespace
 * @param object selectors
 * @param function getStateFn ['selectState', 'useState']
 * @param string property
 * @param array ...args Optional args to pass to the selector
 * @return mixed
 */
const getState = (namespace, selectors, getStateFn, property, ...args) => {
  let globalState;
  if (getStateFn === 'selectState') {
    globalState = global.selectState(namespace);
  } else if (getStateFn === 'useState') {
    globalState = global.useState(namespace)[0];
  }

  if (selectors[property]) {
    return selectors[property](globalState, ...args);
  } else {
    // if no property is set, just return the state
    if (property === undefined) {
      return globalState;
    }

    return globalState.get(property, undefined);
  }
};

export default class Store {
  /**
   * Initializes a new Store
   *
   * @param string namespace
   * @param object initialState
   */
  constructor(namespace, initialState) {
    // set the initial state for the store
    global.setState(namespace, Map(initialState));

    this.namespace = namespace;

    this.selectors = {};
    this.sideEffectRunnerKey = 0;
    this.sideEffectRunners = {};
  }

  /**
   * Adds a selector to normalize the data that is being selected
   *
   * @param string property
   * @param function selector
   */
  addSelector(property, selector) {
    assertPropertyFormat(property);
    this.selectors[property] = selector;
  }

  /**
   * Uses the given reducer to reduce the state
   *
   * @param function reducer
   * @return array [didStateChange, oldState, newState]
   */
  reduce(reducer) {
    let oldState = global.selectState(this.namespace);
    let newState = reducer(oldState);

    return [global.setState(this.namespace, newState), oldState, newState];
  }

  /**
   * Registers the given side-effect runner for the specified event
   *
   * @param string event
   * @param function sideEffectRunner
   * @return function Function that can be used to unregister
   */
  register(event, sideEffectRunner) {
    assertEventFormat(event);

    if (!this.sideEffectRunners[event]) {
      this.sideEffectRunners[event] = {};
    }

    let key = this.sideEffectRunnerKey++;
    this.sideEffectRunners[event][key] = sideEffectRunner;

    return function () {
      delete this.sideEffectRunners[event][key];
    }.bind(this);
  }

  /**
   * Accesses the state specified by the given property
   * This method call does not register for updates so the value could be stale
   *
   * @param string property
   * @param array ...args Optional extra arguments passed to the selector
   * @return mixed
   */
  selectState(property, ...args) {
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
   *
   * @param function dispatch
   * @param string event
   * @param array ...payload Optional payload for the event
   * @return array The side effects that started
   */
  startSideEffects(dispatch, event, ...payload) {
    let sideEffects = [];
    for (let key in this.sideEffectRunners[event]) {
      sideEffects.push({
        promise: Promise.resolve(
          this.sideEffectRunners[event][key](dispatch, ...payload),
        ),
        store: this,
      });
    }

    return sideEffects;
  }

  /**
   * Accesses the state specified by the given property
   * This method call registers for updates so the value is always up-to-date
   *
   * @param string property
   * @param array ...args Optional extra arguments passed to the selector
   * @return mixed
   */
  useState(property, ...args) {
    return getState(
      this.namespace,
      this.selectors,
      'useState',
      property,
      ...args,
    );
  }
}
