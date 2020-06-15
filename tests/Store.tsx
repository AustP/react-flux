import { act, render, screen } from '@testing-library/react';
import React from 'react';

import flux from '../src/flux';
import Store from '../src/Store';

type Order = {
  members: string[];
};

beforeAll(() => flux.setOption('displayLogs', false));

describe('Store', () => {
  let radiantsStore: Store;
  let warcampStore: Store;
  test('it can be added to the flux system', () => {
    radiantsStore = flux.addStore('radiants', {
      windrunners: {
        members: ['Kaladin Stormblessed'],
      },
    });

    expect(radiantsStore.selectState('windrunners')).toEqual({
      members: ['Kaladin Stormblessed'],
    });

    warcampStore = flux.addStore('warcamp', {
      bridgeCrews: 24,
      soldiers: 11700,
    });
  });

  describe('side-effect runners', () => {
    test("that are synchronous and don't update the state", async () => {
      radiantsStore.register('radiants/callToBattle', () => {
        // mock async requests that we don't care about waiting for
        // tslint:disable-next-line no-unused-expression
        new Promise((resolve) => setTimeout(resolve, 0));
      });

      await flux.dispatch('radiants/callToBattle');
      expect(radiantsStore.selectState()).toEqual({
        windrunners: {
          members: ['Kaladin Stormblessed'],
        },
      });
    });

    test('that are synchronous and update the state', async () => {
      radiantsStore.register('radiants/addLightweavers', () => (state) => ({
        ...state,
        lightweavers: { members: ['Shallan Davar'] },
      }));

      await flux.dispatch('radiants/addLightweavers');
      expect(radiantsStore.selectState('lightweavers')).toEqual({
        members: ['Shallan Davar'],
      });

      warcampStore.register('warcamp/addBridgeCrew', () => (state) => ({
        ...state,
        bridgeCrews: (state.bridgeCrews as number) + 1,
      }));

      await flux.dispatch('warcamp/addBridgeCrew');
      expect(warcampStore.selectState('bridgeCrews')).toBe(25);
    });

    test("that are asynchronous and don't update the state", async () => {
      radiantsStore.register('radiants/recruit', async () => {
        // mock async requests that fetch data from the server, for example
        const recruitmentList = await new Promise((resolve) =>
          setTimeout(resolve, 0),
        );

        // tslint:disable-next-line no-unused-expression
        await new Promise((resolve) =>
          setTimeout(() => resolve(recruitmentList), 0),
        );
      });

      await flux.dispatch('radiants/recruit');
      expect(radiantsStore.selectState()).toEqual({
        lightweavers: {
          members: ['Shallan Davar'],
        },
        windrunners: {
          members: ['Kaladin Stormblessed'],
        },
      });
    });

    test('that are asynchronous and update the state', async () => {
      radiantsStore.register('radiants/addBondsmiths', async () => {
        // mock async requests that fetch data from the server, for example
        const bondsmiths = await new Promise((resolve) =>
          setTimeout(() => resolve({ members: ['Dalinar Kohlin'] }), 0),
        );

        return (state) => ({ ...state, bondsmiths });
      });

      await flux.dispatch('radiants/addBondsmiths');
      expect(radiantsStore.selectState('bondsmiths')).toEqual({
        members: ['Dalinar Kohlin'],
      });

      warcampStore.register('warcamp/recruitSoldiers', async () => {
        // mock async requests that fetch data from the server, for example
        const amount = await new Promise<number>((resolve) =>
          setTimeout(() => resolve(100), 0),
        );

        return (state) => ({
          ...state,
          soldiers: (state.soldiers as number) + amount,
        });
      });
    });

    test('that are unsubscribed', async () => {
      const unsubscribe = warcampStore.register(
        'warcamp/surrender',
        () => (state) => ({}),
      );

      unsubscribe();
      await flux.dispatch('warcamp/surrender');
      expect(warcampStore.selectState()).toEqual({
        bridgeCrews: 25,
        soldiers: 11700,
      });
    });

    test('that have parameters', async () => {
      const sideEffectRunner = jest.fn((dispatch, requester, receiver) => {
        // attempt to make an alliance here
      });
      warcampStore.register('warcamp/attemptAlliance', sideEffectRunner);

      await flux.dispatch('warcamp/attemptAlliance', 'Dalinar', 'Roion');
      expect(sideEffectRunner.mock.calls.length).toBe(1);
      expect(sideEffectRunner.mock.calls[0][1]).toBe('Dalinar');
      expect(sideEffectRunner.mock.calls[0][2]).toBe('Roion');
    });
  });

  describe('selectors', () => {
    test('that were not previously defined', () => {
      radiantsStore.addSelector(
        'leader',
        (state) => (state.bondsmiths as Order).members[0],
      );

      expect(radiantsStore.selectState('leader')).toBe('Dalinar Kohlin');
    });

    test('that were previously defined', () => {
      radiantsStore.addSelector('lightweavers', () => 'Nothing to see here!');

      expect(radiantsStore.selectState('lightweavers')).toBe(
        'Nothing to see here!',
      );
    });

    test('that have parameters', async () => {
      const selector = jest.fn((state, orderName: string) => {
        const order = state[orderName] as Order | undefined;
        if (order === undefined) {
          return 0;
        }

        return order.members.length;
      });
      radiantsStore.addSelector('memberCount', selector);

      const memberCount = radiantsStore.selectState(
        'memberCount',
        'lightweavers',
      );
      expect(selector.mock.calls.length).toBe(1);
      expect(selector.mock.calls[0][1]).toBe('lightweavers');
      expect(memberCount).toBe(1);
    });
  });

  describe('accessing the state', () => {
    test('from outside a component', () => {
      expect(warcampStore.selectState('bridgeCrews')).toBe(25);
    });

    test("from inside a component when the value doesn't need to stay up-to-date", async () => {
      function StaticComponent() {
        const bridgeCrews = warcampStore.selectState<number>('bridgeCrews');
        return <span>{bridgeCrews}</span>;
      }

      render(<StaticComponent />);
      expect(screen.getByText('25')).toBeDefined();

      await act(() => flux.dispatch('warcamp/addBridgeCrew'));
      expect(screen.queryByText('26')).toBeNull();
      expect(screen.getByText('25')).toBeDefined();
    });

    test('from inside a component when the value needs to stay up-to-date', async () => {
      function DynamicComponent() {
        const soldiers = warcampStore.useState<string>('soldiers');
        return <span>{soldiers}</span>;
      }

      render(<DynamicComponent />);
      expect(screen.getByText('11700')).toBeDefined();

      await act(() => flux.dispatch('warcamp/recruitSoldiers'));
      expect(screen.queryByText('11700')).toBeNull();
      expect(screen.getByText('11800')).toBeDefined();
    });

    test('from inside a component when the value needs to stay up-to-date and using the whole state', async () => {
      function DynamicComponent() {
        const state = warcampStore.useState();
        return <span>{state.soldiers as string}</span>;
      }

      render(<DynamicComponent />);
      expect(screen.getByText('11800')).toBeDefined();

      await act(() => flux.dispatch('warcamp/recruitSoldiers'));
      expect(screen.queryByText('11800')).toBeNull();
      expect(screen.getByText('11900')).toBeDefined();
    });
  });
});
