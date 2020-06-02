import { fromJS, is } from 'immutable';
import { useCallback, useEffect, useState as useReactState } from 'react';

// the global state
let global = {};

// subscription management variables
let subscriptionKey = 0;
let subscriptions = {};

/**
 * Checks if the values are different
 * Uses immutable so objects with the same properties are considered the same
 *
 * @param mixed first
 * @param mixed second
 *
 * @return bool
 */
const areValuesDifferent = (first, second) =>
  !is(fromJS(first), fromJS(second));

/**
 * Helper method to set multiple values at once (usually on init)
 *
 * @param obj state
 */
const init = (state) => {
  for (let key in state) {
    setState(key, state[key]);
  }
};

/**
 * Selects the specified property from the global state
 *
 * @param string property
 * @return mixed
 */
const selectState = (property) => global[property];

/**
 * Sets the property to the specified value
 * Informs subscribers that the property was changed
 *
 * @param string property
 * @param mixed value
 * @return bool Whether or not the state was changed
 */
const setState = (property, value) => {
  if (areValuesDifferent(global[property], value)) {
    global[property] = value;

    for (let key in subscriptions[property]) {
      subscriptions[property][key](value);
    }

    return true;
  }

  return false;
};

/**
 * Subscribes the callback to be called whenever the property changes
 *
 * @param string property
 * @param func subscription
 * @return func A callback function that unsubscribes to changes
 */
const subscribe = (property, subscription) => {
  if (!subscriptions[property]) {
    subscriptions[property] = {};
  }

  let key = subscriptionKey++;
  subscriptions[property][key] = subscription;

  return () => {
    delete subscriptions[property][key];
  };
};

/**
 * Gets the specified property from the global state
 * Subscribes for any changes made via set
 *
 * @param string property
 * @return array An array matching useState's return i.e. [value, setValue]
 */
const useState = (property) => {
  let globalValue = selectState(property);
  let [reactValue, setReactValue] = useReactState(globalValue);

  // wrap our subscription in useEffect so
  // we can unsubscribe when the component unmounts
  useEffect(() => subscribe(property, (value) => setReactValue(value)), [
    property,
    setReactValue,
  ]);

  return [
    reactValue,
    useCallback((value) => setState(property, value), [property]),
  ];
};

export default { init, selectState, setState, useState };
