import { useCallback, useLayoutEffect, useState as useReactState } from 'react';

type State = { readonly [key: string]: unknown };
type Subscription = (value: any) => void;
type UnsubscribeCallback = () => void;

// the state manager
let stateManager: State = Object.freeze({});

// subscription management variables
let subscriptionKey: number = 0;
const subscriptions: {
  [property: string]: {
    [subscriptionKey: number]: Subscription;
  };
} = {};

/**
 * Helper method to set multiple values at once (usually on init)
 */
const init = (state: State): void => {
  for (const key in state) {
    if (state.hasOwnProperty(key)) {
      setState(key, state[key]);
    }
  }
};

/**
 * Selects the specified property from the state manager
 */
const selectState = <T = unknown>(property: string): T =>
  stateManager[property] as T;

/**
 * Sets the property to the specified value. Informs subscribers that the
 * property was set.
 */
const setState = (property: string, value: any): void => {
  stateManager = Object.freeze({ ...stateManager, [property]: value });
  for (const key in subscriptions[property]) {
    if (subscriptions[property].hasOwnProperty(key)) {
      subscriptions[property][key](value);
    }
  }
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
 * Gets the specified property from the state manager. Subscribes for any
 * changes made via set
 */
const useState = <T = unknown>(property: string): [T, (value: T) => void] => {
  const stateValue = selectState<T>(property);
  const [reactValue, setReactValue] = useReactState<T>(stateValue);

  // wrap our subscription in useLayoutEffect so
  // we can unsubscribe when the component unmounts
  useLayoutEffect(
    () => subscribe(property, (value: T) => setReactValue(value)),
    [property, setReactValue],
  );

  return [
    reactValue,
    useCallback((value: T) => setState(property, value), [property]),
  ];
};

export default { init, selectState, setState, useState };
export { State };
