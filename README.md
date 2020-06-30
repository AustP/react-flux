# react-flux

react-flux is a React state management library with an emphasis on side-effects and global state.

## Installation

```(bash)
yarn add @aust/react-flux
```

## Usage

react-flux is a flux implementation. This means you will create stores and use reducers to update the state in response to events that are dispatched. As we go through how to use react-flux, we will show how to solve a real-world problem: user authentication.

To access the flux API:

```(ts)
import flux from '@aust/react-flux';
```

### Creating a Store

When working with stores, it is best to keep all of the store's logic in the same file. i.e. put all of the event registrations and selectors in the same file that you add the store to the flux system. If you don't do this, you may run into issues when working with fast-refresh.

When you create a store, you must specify a unique namespace for the store as the first parameter and the initial state of the store as the second parameter.

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

If you want your runner to update the store's state, you can either return a [reducer](#reducer-function) (to update immediately) or a promise that resolves with a reducer (to update eventually). If you don't want your runner to update the state at all, simply don't return anything or return a promise that doesn't resolve with anything (this is useful when a side-effect requires the result from another side-effect).

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

The reducer function is given the store's current state as it's one and only parameter. It is the reducer's job to use that state to calculate and return the new state for the store.

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
      type="email"
      value={email}
    />
    <input
      onChange={(e) => setPassword(e.target.value)}
      type="password"
      value={password}
    />
    <button
      onClick={() => flux.dispatch('auth/login', email, password)}
      type="button"
    >
      Login
    </button>
  </>;
}
```

### Getting an Event's Status

In our applications, we often want to display loading indicators while waiting for a side-effect to finish. Additionally we want to let the user know when an error occurs. react-flux makes this easy by providing two methods: `selectStatus` and `useStatus`. (See [When to use selectState/selectStatus vs useState/useStatus](#when-to-use-selectstateselectstatus-vs-usestateusestatus)). These methods give you access to an event's status. Let's update our `LoginForm` component to display a loading indicator and handle errors.

```(tsx)
export default function LoginForm() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const { dispatching, error, payload } = flux.useStatus('auth/login');

  if (error) {
    console.log(payload);
  }

  return <>
    <input
      onChange={(e) => setEmail(e.target.value)}
      type="email"
      value={email}
    />
    <input
      onChange={(e) => setPassword(e.target.value)}
      type="password"
      value={password}
    />
    {error && <ErrorMessage>{(error as Error).message}</ErrorMessage>}
    <button
      disabled={dispatching}
      onClick={() => flux.dispatch('auth/login', email, password)}
      type="button"
    >
      {dispatching ? 'Authenticating...' : 'Login'}
    </button>
  </>;
}
```

Notice that we added a call to `flux.useStatus('auth/login')`, a conditional logging of the event's payload, a conditional rendering of the `ErrorMessage` component, and finally, we edited the text for the `button` component to conditionally show `Authenticating...`.

**NOTE: The `payload` key will be set to the latest payload that was dispatched with the event.**

Let's talk a little bit more about error handling. If a side-effect runner or a reducer throws an error that isn't caught, then that thrown error will be set to the `error` key. Additionally, react-flux will dispatch the `flux/error` event with the name of the event that threw the error, the thrown error, and the payload that the event was dispatched with.

```(ts)
store.register('flux/error', (event, error, ...payload)) {
  if (event === 'auth/login') {
    displayError(error);
  }
}
```

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

Now that our store is setup, we need to be able to access the state. But before we can access the state, we need to have access to the store. Most of the time when you want to access the state, it will not be in the store file so you'll need another way to access the store. When you add a store to the flux system, it is exposed via the flux object at the namespace you gave the store. To access our auth store for example, we would do this:

```(ts)
import flux from '@aust/react-flux';

const store = flux.auth;
```

Now that we have a reference to the store, we can use the two methods available from a store object: `selectState` and `useState`. (See [When to use selectState/selectStatus vs useState/useStatus](#when-to-use-selectstateselectstatus-vs-usestateusestatus)). Both of these methods take a string as their parameter. The string that is passed will be used to first look if there is a matching selector. If there is a matching selector, the selector function will be ran. If there is no matching selector, the string will be used as a key to acccess the store's state.

```(tsx)
export default function UserName() {
  const name = flux.useState('tokenPayload', 'name');

  return <span>{name}</span>;
}
```

## When to use selectState/selectStatus vs useState/useStatus

`store.selectState(...)` and `flux.selectStatus(...)` both give you their respective values *at that moment*. This means that when the store's state changes or the event's status changes, your variables containing these values will become stale.

**NOTE: `selectState` and `selectStatus` can be called from anywhere in your codebase.**

`store.useState(...)` and `flux.useStatus(...)` both give you their respective values while also registering for changes via React hooks. This means that when the store's state changes or the event's status changes, the component/custom hook that called `useState`/`useStatus` will re-render with the latest information.

**NOTE: `useState` and `useStatus` must be called from in a React component or a custom hook.**

What you should focus on is **whether or not you need the retrieved value to always reflect the value that is in the state**. If you need the value to always stay up-to-date, then you should use: `useState`/`useStatus`. Otherwise, you should use: `selectState`/`selectStatus`.

## Options

react-flux has two options currently. Options can be set using `flux.setOption(option, value)`.

```(js)
flux.setOption('displayLogs', inDevMode);
```

|             | description | default |
|-------------|-------------|---------|
| displayLogs | When set to true, the event dispatch tree will be logged to the console. | true |
| longDispatchTimeout | The amount of time (in ms) before logging a warning about a long dispatch | 5000 |
