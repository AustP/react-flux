import { fromJS, is } from 'immutable';
import { useCallback, useEffect, useState as useReactState } from 'react';

type SetValueCallback = (value: unknown) => boolean;
type Subscription = (value: unknown) => void;
type UnknownObject = { [key: string]: unknown };
type UnsubscribeCallback = () => void;

// the state manager
const stateManager: UnknownObject = {};

// subscription management variables
let subscriptionKey: number = 0;
const subscriptions: {
  [property: string]: {
    [subscriptionKey: number]: Subscription;
  };
} = {};

/**
 * Checks if the values are different
 * Uses immutable so objects with the same properties are considered the same
 */
const areValuesDifferent = (first: unknown, second: unknown): boolean =>
  !is(fromJS(first), fromJS(second));

/**
 * Helper method to set multiple values at once (usually on init)
 */
const init = (state: UnknownObject): void => {
  for (const key in state) {
    if (state.hasOwnProperty(key)) {
      setState(key, state[key]);
    }
  }
};

/**
 * Selects the specified property from the state manager
 */
const selectState = (property: string): unknown => stateManager[property];

/**
 * Sets the property to the specified value
 * Informs subscribers that the property was changed
 * Returns whether or not the state was changed
 */
const setState = (property: string, value: unknown): boolean => {
  if (areValuesDifferent(stateManager[property], value)) {
    stateManager[property] = value;

    for (const key in subscriptions[property]) {
      if (subscriptions[property].hasOwnProperty(key)) {
        subscriptions[property][key](value);
      }
    }

    return true;
  }

  return false;
};

/**
 * Subscribes the callback to be called whenever the property changes
 */
const subscribe = (
  property: string,
  subscription: Subscription,
): UnsubscribeCallback => {
  if (!subscriptions[property]) {
    subscriptions[property] = {};
  }

  const key = subscriptionKey++;
  subscriptions[property][key] = subscription;

  return (): void => {
    delete subscriptions[property][key];
  };
};

/**
 * Gets the specified property from the state manager
 * Subscribes for any changes made via set
 */
const useState = (property: string): [unknown, SetValueCallback] => {
  const stateValue = selectState(property);
  const [reactValue, setReactValue] = useReactState(stateValue);

  // wrap our subscription in useEffect so
  // we can unsubscribe when the component unmounts
  useEffect(() => subscribe(property, (value) => setReactValue(value)), [
    property,
    setReactValue,
  ]);

  return [
    reactValue,
    useCallback((value: unknown) => setState(property, value), [property]),
  ];
};

export default { init, selectState, setState, useState };
export { UnknownObject };
