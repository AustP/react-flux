# react-flux

react-flux is a React state management library with an emphasis on side-effects and global state.

## Installation

```(bash)
yarn add @aust/react-flux
```

## Basic Example

Stores are at the heart of react-flux; they store and manage the state. Before we can do anything, we must first add a store to the flux system.

### userStore.ts

```(ts)
import flux, { Store } from '@aust/react-flux';

const store = flux.addStore('user', {
  name: ''
});

store.register('user/setName', (dispatch, name) => () => ({ name }));

// if you're not using typescript, ignore this next bit
declare global {
  interface Flux {
    user: Store<{
      name: string;
    }>;
  }
}
```

Now that we've got our store setup, let's create a Form component that will use the state.

### Form.tsx

```(ts)
import flux from '@aust/react-flux';
import React from 'react';

export default function Form() {
  const name = flux.user.useState('name');

  return (
    <div>
      <span>Please type your name:</span>
      <input
        onChange={e => flux.dispatch('user/setName', e.target.value)}
        type='text'
        value={name}
      />
    </div>
  );
}
```

Notice in this example we might as well be using `React.useState`. However, you can call `flux.dispatch` from *anywhere* in your codebase and this Form component would update to match the latest value. Let's build another component that demonstrates this concept.

### Randomizer.tsx

```(ts)
import flux from '@aust/react-flux';
import React from 'react';

export default function Randomizer() {
  const names = ['Dalinar', 'Kaladin', 'Jasnah', 'Shallan'];

  return (
    <button
      onClick={() =>
        flux.dispatch(
          'user/setName',
          names[Math.floor(Math.random() * names.length)]
        )
      }
    >
      Randomize
    </button>
  );
}
```

Again, this could all be handled via `React.useState` and some sort of wrapper component, but that's already getting complicated. Additionally, `React.useState` breaks down completely if you need to update the state from outside the React component tree (an ajax request for example) whereas react-flux can update the state from anywhere.

Now that we've got all of our pieces, let's put it all together.

### App.tsx

```(ts)
import React from 'react';

import './userStore';
import Form from './Form';
import Randomizer from './Randomizer';

export default function App() {
  return (
    <div>
      <Form />
      <Randomizer />
    </div>
  );
}
```

You can check out a working demo at [codesandbox.io/s/keen-meadow-nwfpk](https://codesandbox.io/s/keen-meadow-nwfpk?file=/src/App.tsx). The power of this library comes when you need to update the state from *outside* the React component tree. With this library it's as simple as making a call to `flux.dispatch`. Keep reading for more details.

## Usage

react-flux is a flux implementation. This means you will create stores and use reducers to update the state in response to events that are dispatched. As we go through how to use react-flux, we will show how to solve a real-world problem: user authentication.

To access the flux API:

```(ts)
import flux from '@aust/react-flux';
```

### Creating a Store

When working with stores, it is best to keep all of the store's logic in the same file. i.e. put all of the event registrations and selectors in the same file that you add the store to the flux system. If you don't do this, you may run into issues when working with fast-refresh.

When you create a store, you must specify a unique namespace for the store as the first parameter and the initial state of the store as the second parameter. (You will eventually use this namespace to access the store instance).

```(ts)
const store = flux.addStore('auth', {
  token: null
});
```

### Registering for Events

In react-flux, rather than immediately reducing the state when seeing an event, the store has the chance to trigger any side-effects. After the side-effects are triggered (and possibly awaited), then the state can be reduced.

This means that when you register a store to watch for a specific event, you need to supply a [side-effect runner](#side-effect-runner).

**NOTE: Events must be formatted like: namespace/event.**

```(ts)
store.register('auth/login', async (dispatch, email, password) => {
  // make a POST fetch request to authenticate the user
  const token = await makeALoginRequest(email, password);

  // now that we've authenticated, we will return a reducer function
  return () => ({ token });
});

store.register('auth/logout', () => () => ({
  token: null,
}));
```

#### Side-Effect Runner

```(ts)
type DispatchCallback = (event: string, ...payload: any[]) => Promise<void>;
type SideEffectRunner = (dispatch: DispatchCallback, ...payload: any[]) => Promise<Reducer | void> | Reducer | void;
```

When the side-effect runner triggers, it is given a dispatch callback as it's first parameter. Any parameters used when dispatching the event that triggered the runner will also be passed to the runner.

**NOTE: If your runner needs to dispatch an event, you should use the given dispatch callback to make logging work correctly.**

```(ts)
dispatch('some/event', 'some', 'values');

// in some store file
store.register('some/event', (dispatch, param1, param2) => {
  // `dispatch` can be used to dispatch new events
  // `param1` === 'some'
  // `param2` === 'values'
});
```

If you want your runner to update the store's state, you can either return a [reducer](#reducer-function) (to update immediately) or a promise that resolves with a reducer (to update eventually). If you don't want your runner to update the state at all, simply don't return anything or return a promise that doesn't resolve with anything.

```(ts)
// these runners update the state
store.register('reduce/immediately', () => {
  sideEffect1();

  return (state) => ({...state, sideEffect1Triggered: true});
});
store.register('reduce/eventually', async () => {
  const result = await sideEffect2();

  return (state) => ({...state, result});
});

// these runners don't update the state
store.register('trigger/side-effects', () => {
  sideEffect1();
});
store.register('trigger/side-effects-with-dependencies', async () => {
  const result = await sideEffect2();
  sideEffect3(result);
});
```

#### Reducer Function

```(ts)
type Reducer = (state: {}) => {};
```

The reducer function is given the store's current state as it's one and only parameter. It is the reducer's job to use that state to calculate and return the new state for the store. The reducer *should not* trigger any side-effects, but it may schedule future dispatches. (See [Scheduling Future Dispatches](#scheduling-future-dispatches) for more info).

**NOTE: It is important that the reducer does *not* modify the current state; rather, it must return a new object. Because of this requirement, it is often useful to use the [object literal spread syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax).**

```(ts)
return (state) => ({
  ...state,
  override: 'stuff'
});
```

### Dispatching an Event

When dispatching events, we can pass additional information that will be picked up by the side-effect runners. For our auth system, we could dispatch the `auth/login` event by doing the following:

```(ts)
flux.dispatch('auth/login', 'kaladin@windrunners.com', 'storminglighteyes');
```

However, many events will be dispatched via user interaction so generally dispatching events looks more like this:

```(tsx)
export default function LoginForm() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  return <>
    <input
      onChange={(e) => setEmail(e.target.value)}
      type='email'
      value={email}
    />
    <input
      onChange={(e) => setPassword(e.target.value)}
      type='password'
      value={password}
    />
    <button
      onClick={() => flux.dispatch('auth/login', email, password)}
      type='button'
    >
      Login
    </button>
  </>;
}
```

#### Waiting for Dispatched Events

Any time you dispatch an event, you can await it. This is useful if you need to make sure a certain event fully finishes (and the state is reduced) before continuing on. The value that is resolved will be the event's current status. (See [Getting an Event's Status](#getting-an-events-status)). This can be helpful to test if there was an error while dispatching the event.

```(ts)
const { error } = await flux.dispatch(
  'auth/login',
  'kaladin@windrunners.com',
  'storminglighteyes'
);
if (error) {
  displayError(error);
}
```

### Getting an Event's Status

In our applications, we often want to display loading indicators while waiting for a side-effect to finish. Additionally we want to let the user know when an error occurs. react-flux makes this easy by providing two methods: `selectStatus` and `useStatus`. (See [When to Call the select* Methods vs the use* Methods](#when-to-call-the-select-methods-vs-the-use-methods)). These methods give you access to an event's status. Let's update our `LoginForm` component to display a loading indicator and handle errors.

```(tsx)
  export default function LoginForm() {
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
+   const { count, dispatching, error, payload } = flux.useStatus('auth/login');
+
+   if (error) {
+     console.log(payload);
+   }

    return <>
      <input
        onChange={(e) => setEmail(e.target.value)}
        type='email'
        value={email}
      />
      <input
        onChange={(e) => setPassword(e.target.value)}
        type='password'
        value={password}
      />
+     {error && <ErrorMessage>{(error as Error).message}</ErrorMessage>}
      <button
+       disabled={dispatching}
        onClick={() => flux.dispatch('auth/login', email, password)}
        type='button'
      >
-       Login
+       {dispatching ? 'Authenticating...' : 'Login'}
      </button>
    </>;
  }
```

Now, if there is an error, we log the event's latest payload and display that error the user. Additionally, while the event is dispatching, we disable the button and change it's text to say `Authenticating...`. Not too shabby for 8 additions and 1 deletion.

**NOTE: The `count` key gives the number of times the event has been dispatched.**  
**NOTE: The `payload` key will always be set to the payload of the latest dispatched event.**

### Adding a Selector

When storing state in a store, we often want to prevent duplication of information. Additionally, we may want to perform memoization to prevent expensive function calls. This is where selectors enter the picture. In our authentication system, the token that we are storing is a [JWT](https://jwt.io/introduction/). For this example, assume that our JWT has the user's name and ID as part of it's payload. Let us now add selectors to our store to make it so we can easily access the user's name:

```(ts)
import _jwtDecode from 'jwt-decode';
import memoize from 'memoize-one';

const jwtDecode = memoize(_jwtDecode);

store.addSelector('tokenObject', ({ token }) => token ? jwtDecode(token) : {});
store.addSelector('name', () => store.selectState('tokenObject').name);
```

Here you can see that we first make a memoized version of `_jwtDecode` so if the token doesn't change, then we can access the token object instantly. Next, we add a selector for `tokenObject`. If a token is in the store, this selector will return a token object from it. Finally, we add a selector for `name`. Notice that this selector uses our previous selector to access the token object and return the value specified by the name property. We can now access the user's name but our store's state is still only holding the initial token string.

Selectors can even take additional arguments if needs be. Continuing our example, what if we had multiple properties in the JWT payload that we wanted to access? It might be easier to make a generic selector and pass in the property that we want to access:

```(ts)
store.addSelector(
  'tokenPayload',
  (state, property) => store.selectState('tokenObject')[property]
);

// to access the user's name:
store.selectState('tokenPayload', 'name');

// to acess the user's ID:
store.selectState('tokenPayload', 'id');
```

### Accessing the State

Now that our store is setup, we are ready to access the state. But to access the state we first need a reference to the store. We can find this reference exposed from the flux object at the namespace we specified when adding the store. To access our auth store for example, we would do this:

```(ts)
import flux from '@aust/react-flux';

const store = flux.auth;
```

Now that we have a reference to the store, we can use the two methods available from the store object: `selectState` and `useState`. (See [When to Call the select* Methods vs the use* Methods](#when-to-call-the-select-methods-vs-the-use-methods)). Both of these methods take a string as their first parameter. This string will be used to look for a matching selector function. If there is a matching selector function, it will be ran with any additional parameters being passed to it. If there is no matching selector fun, the string will be used as a key to acccess the store's state. If no matching key is found in the state, the method will return `undefined`.

```(tsx)
export default function UserName() {
  const name = flux.useState('tokenPayload', 'name');

  return <span>{name}</span>;
}
```

## Advanced Usage

Once you're familiar with react-flux and feel comfortable using it, you can learn these advanced topics.

### Using `flux.useStore`

Sometimes, you will have a component that needs to keep track of a decent amount of state but not quite enough to justify creating a new store in it's own file. In these situations, we can use `flux.useStore`.

```(ts)
export default function AddressForm() {
  const { address, city, state, zip } = flux.useStore(
    'AddressForm',
    {
      address: '',
      city: '',
      state: '',
      zip: ''
    }, {
      setAddress: (dispatch, address) => (state) => ({...state, address}),
      setCity: (dispatch, city) => (state) => ({...state, city}),
      setState: (dispatch, state) => (oldState) => ({...oldState, state}),
      setZip: (dispatch, zip) => (state) => ({...state, zip}),
    }
  );

  return (
    <div>
      <TextInput
        label='Address'
        onChange={(value) => flux.dispatch('AddressForm/setAddress', value)}
        value={address}
      />
      <TextInput
        label='City'
        onChange={(value) => flux.dispatch('AddressForm/setCity', value)}
        value={city}
      />
      <TextInput
        label='State'
        onChange={(value) => flux.dispatch('AddressForm/setState', value)}
        value={state}
      />
      <TextInput
        label='Zip Code'
        onChange={(value) => flux.dispatch('AddressForm/setZip', value)}
        value={zip}
      />
    </div>
  );
}
```

`flux.useStore` has a few a advantages and disadvantages compared to multiple calls to `React.useState`.

#### Advantages

1. Consistent state management.
2. Ability to trigger side-effects before reducing the state.
3. Co-location of state reduction logic.
4. Ability to update the state from outside the component.
5. Ability to share state between every instance of a component.

#### Disadvantages

1. More boilerplate.

#### Dependencies

By default, when you call `flux.useStore`, the supplied side-effect runners are only registered initially. This means that if you re-render the component, the old side-effect runners will be used. This is usually fine unless you are accessing variables from the component-level scope inside of your runners. If you are doing this, then you will need to supply as the fourth argument to `flux.useStore` a list of variables that you are accessing from within your runners. This list works exactly like [`React.useEffect`'s dependency list](https://reactjs.org/docs/hooks-effect.html#tip-optimizing-performance-by-skipping-effects).

```(ts)
export default function ScoreBoard() {
  const multiplier = flux.game.selectState('multiplier');
  const { score } = flux.useStore(
    'ScoreBoard',
    {
      score: 0
    },
    {
      addPoints: (dispatch, points) => state => ({
        score: state.score + multiplier * points
      })
    },
    [multiplier]
  );

  return <span>Your score is {score}.</span>;
}
```

### Waiting for Events

Every call to `flux.dispatch` (or to the `dispatch` parameter passed to side-effect runners) returns a promise. This promise will resolve when the event finishes going through the reduction phase. This means you can dispatch an event and wait for it to finish modifying the state before proceeding.

```(ts)
await flux.dispatch('auth/login', 'kaladin@windrunners.com', 'storminglighteyes');

const name = flux.selectState('tokenPayload', 'name');
```

### Scheduling Future Dispatches

You can of course dispatch new events during the side-effects phase of an event but sometimes you want to make sure the next event is dispatched *after* the reduction phase of the current event. You can accomplish this by calling `dispatch` from the reducer function.

```(ts)
store.register('auth/reauthenticate', (dispatch) => {
  dispatch('some/event'); // some/event gets dispatched immediately

  return (state) => {
    dispatch('another/event'); // another/event will dispatch after this one
    return state;
  };
});
```

## When to Call the select\* Methods vs the use\* Methods

As the names imply, the `useState`/`useStatus` methods not only retreive the values (like the `selectState`/`selectStatus` methods) but they additionally register for changes via React hooks. This has some implications on where we can call these methods.

The biggest factor of determining when to call the `select*` methods vs the `use*` methods is the location of the code that is calling these methods.

**If your calling code is outside of the React component tree...**

...you must call the `select*` methods. Because the `use*` methods use React hooks, it is impossible to call them here.

**If your calling code is within the React component tree...**

...it depends on whether or not you need the retrieved value to always reflect the stored value. If you do, then call the `use*` methods. Otherwise, you should call the `select*` methods.

## Options

react-flux has two options currently. Options can be set using `flux.setOption(option, value)`.

```(js)
flux.setOption('displayLogs', inDevMode);
```

|             | description | default |
|-------------|-------------|---------|
| displayLogs | When set to true, the event dispatch tree will be logged to the console. | true |
| longDispatchTimeout | The amount of time (in ms) before logging a warning about a long dispatch | 5000 |
