# react-flux

This is a flux implementation for React. The primary focus of this library is to allow you to have global state in a React application while simultaneously putting side-effects at the center of your state management. You could probably use React's useState to accomplish this, but you will pull your hair out when you have to:

1. Deal with the React Context API.
2. Prevent the entire component tree from pointless re-rendering.
3. Figure out why your state is randomly updating.
4. Access or update the state from outside the component tree.

Save your hair, use react-flux.

## A New Paradigm for Accessing State

Before diving in to how to use this library, we want to explain the thought process we ought to have when accessing state.

We tend to think that there is only one way to access state. After all, when you need a value from the state, you simply retrieve it. However, more often than not in our React applications, we don't just want to access the value that is currently in the state, we want our components to *reflect* the values that are in the state. In other words, sometimes we want our components to re-render whenever the state changes so the value is always up-to-date.

This means that we need to have two methods to access the state. One for simply retrieving the state, and another for retrieving the state while also registering for changes.

To help you decide which method to use, whenever you need to access the state, you should focus on **whether or not you need the retrieved value to always reflect the value that is in the state.** If you need the value to always stay up-to-date, then you should use: `useState`. Otherwise, you should use: `selectState`. See below for more details on these methods.

## Usage

### Setting up the Store

This is a flux implementation but because side-effects are placed front and center, rather than adding reducers immediately to the stores, you will need to add side-effect runners. These side-effect runners will need to return reducer functions if you want to reduce the state. Let's look at a simple store as an example:

```(js)
// this store handles the authentication of our user
const store = flux.addStore('auth', {
  token: null,
});

// we can use selectors to override properties for convenience
store.addSelector('token', (state) => jwtDecode(state.get('token'));

// we can also add properties using selectors
store.addSelector('username', (state) => store.selectState('token').username);

store.register('auth/login', async (dispatch, username, password) => {
  // make a POST fetch request to authenticate the user
  const token = await makeALoginRequest(username, password);

  // now that we've authenticated, we will return a reducer function
  return (state) => state.set('token', token);
});
```

The API is explained in more detail below, but for now focus on the `store.register` function. Notice that we register to listen for the `auth/login` event. When that event is dispatched, it will be dispatched with the username and the password that we are authenticating. After it is dispatched, our supplied side-effect runner will be executed.

Notice that our side-effect runner is indeed executing a side-effect, i.e. it is making a request to our backend server to see if the username/password are correct. If it is correct, a JWT token will be returned which we then want to save in our store so we can use it later. We save it by returning a reducer function that takes the current state of the store and returns the new state with the new token.

*NOTE: Side-effect runners are not required to return reducer functions.*  
*NOTE: react-flux uses Immutable.js while reducing and selecting for easier state management.*

### Accessing the State

```(js)
export function DynamicGreetings() {
  // because we are using useState,
  // this component will re-render when the state changes
  const username = flux.auth.useState('username');

  return `Welcome, ${username}`;
}

export function StaticGreetings() {
  // because we are using selectState,
  // this component will not re-render when the state changes
  const username = flux.auth.selectState('username');

  return `Howdy, ${username}`;
}
```

The above two components both access the state. The DynamicGreetings component uses `useState` so it registers for state changes and will re-render if the username updates.

The StaticGreetings component on the other hand uses `selectState` so it will display the value that is currently in the state when it renders and won't register for updates. If it gets re-rendered by React (a component above re-rendering for example), it will select the current value again. If the value had changed between those two times, then it will be displaying a different value.

```(js)
function randomFunctionOutsideReactTree() {
  // can't use flux.auth.useState('username') here
  const username = flux.auth.selectState('username');

  // ...
}
```

Because `useState` uses React hooks, it can only be called from within a React component or a custom hook. If you need to access the state outside of the React component tree, you can do so using `selectState`.

### Dispatching Events

```(js)
export default function LoginForm() {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const { dispatching, error } = flux.useStatus('auth/login');

  return <>
    <input onChange={(e) => setUsername(e.target.value)} type="text" value={username} />
    <input onChange={(e) => setPassword(e.target.value)} type="password" value={password} />
    {error && <ErrorMessage>{error.message}</ErrorMessage>}
    <button
      disabled={dispatching}
      onClick={() => flux.dispatch('auth/login', username, password)}
      type="button"
    >
      {dispatching ? 'Authenticating...' : 'Login'}
    </button>
  </>;
}
```

Dispatching events is pretty straight forward. You simply call `flux.dispatch` with any additional parameters that will be forwarded to the side-effect runner in the same order.

Also notice that react-flux has loading and error states built-in via the `flux.useStatus` method. `dispatching` will be true the moment an event is dispatched until it finishes reducing. `error` will be populated with any Error object that is not caught from a side-effect runner or from a reducer.

## Flux API

### flux.addStore(storeName: string, initialState: object)

Adds a store to the flux system.

*storeName*: The namespace of the store that will be used when accessing the state and dispatching events.  
*initialState*: The initial state of the store.

### flux.dispatch(event: string, [...otherArguments])

Dispatches the specified event with any additional arguments supplied.

*event*: The event to dispatch.  
*...otherArguments*: These arguments will be passed to the side-effect runners.

### flux.selectStatus(event: string)

Selects the status of the given event. The status object contains:

- *dispatching*: Whether or not the event is dispatching.
- *error*: An Error object that was thrown from a side-effect runner or reducer.
- *payload*: The latest payload (additional arguments) that the event was dispatched with.

*event*: The event to get the status for.

### flux.useStatus(event: string)

Selects the status of the given event and additionally registers for updates from the event. The status object contains:

- *dispatching*: Whether or not the event is dispatching.
- *error*: An Error object that was thrown from a side-effect runner or reducer.
- *payload*: The latest payload (additional arguments) that the event was dispatched with.

*event*: The event to get the status for.  
**NOTE: Must be called from within a React component or custom hook.**

### flux.useStore(storeName: string, initialState: object, listeners: object)

Shortcut method for setting up a store within a component. Returns an object with keys that match the initial state that reflect the values in the store.

*storeName*: The name of the store.  
*initialState*: The initial state of the store.  
*listeners*: An object with keys as the un-namespaced events and the values as the side-effect runners.  
**NOTE: Must be called from within a React component or custom hook.**

```(js)
const { count } = flux.useStore(
  'CountingStore',
  { count: 0 },
  {
    increment: () => (state) => state.set('count', state.get('count') + 1)
  }
);

// flux.dispatch('CountingStore/increment');
```

### flux[storeName]

If you need to access a store, you can access it directly off of the flux object by supplying the store's name.

```(js)
flux.addStore('someStore', {
  someValue: 117
});

// later
flux.someStore.selectState('someValue');
flux['someStore'].selectState('someValue');
```

## Store API

### store.addSelector(property: string, selector: function)

Adds a selector that will be called whenever trying to access the specified property.

*property*: The property to select for. Note: You can override existing properties.  
*selector(state: Map, [...otherArguments])*: The function that will be called when accessing the property. The first argument passed to the selector will be the current state of the store. Any other arguments passed to the state selector function will be passed to the selector in the same order.

### store.register(event: string, sideEffectRunner: function)

Registers the store to listen for the specified event. When the event gets dispatched, the side-effect runner will execute.

*event*: The event to register for.  
*sideEffectRunner(dispatch: function, [...otherArguments])*: The function that executes when the specified event is dispatched. The first parameter to the side-effect runner is a dispatch function. Any other arguments passed to the dispatcher for the specified event will be passed to the side-effect runner in the same order. If the store needs to be reduced after running the side-effects, the side-effect runner should return a *reducer(state: Map)* function. The reducer function takes the state as it's one and only argument and must return the new state.  
**NOTE: If the side-effect runner or reducer needs to dispatch any events, they should use the given dispatch function rather than flux.dispatch so the logging system works correctly.**

### store.selectState(property: string, [...otherArguments])

Selects the given property from the state. Will go through a selector if it's defined, otherwise, it will just access the state.

*property*: The property to access in the state.  
*...otherArguments*: Any other arguments passed to this function will get passed to the selector function in the same order.

### store.useState(property: string, [...otherArguments])

Selects the given property from the state and additionally registers for state updates. Will go through a selector if it's defined, otherwise, it will just access the state.

*property*: The property to access in the state.  
*...otherArguments*: Any other arguments passed to this function will get passed to the selector function in the same order.  
**NOTE: Must be called from within a React component or custom hook.**

## Errors

If an error is thrown from a side-effect runner or reducer, react-flux will catch it and update the status to include the error. The most recent payload for the event is also included in the status.

```(js)
const { error, payload } = flux.useStatus('auth/login');
// error is set to the thrown error
// error gets reset to null whenever the event is dispatched
```

react-flux will also dispatch another event, `flux/error`, with the event name, the error, and the payload. This can be useful if you want to globally display all errors or perform any other logic when an error is thrown.

## Options

react-flux has two options currently. Options can be set using `flux.setOption(option, value)`.

```(js)
flux.setOption('displayLogs', inDevMode);
```

|             | description | default |
|-------------|-------------|---------|
| displayLogs | When set to true, the event dispatch tree will be logged to the console. | true |
| longDispatchTimeout | The amount of time (in ms) before logging a warning about a long dispatch | 5000 |
