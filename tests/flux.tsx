import { act, render, screen } from '@testing-library/react';
import React from 'react';

import flux, { Store } from '../src/flux';

declare global {
  interface Flux {
    warcamp2: Store<{ bridgeCrews: number; soldiers: number }>;
  }
}

const TIMEOUT_PAY_SOLDIERS = 200;
const TIMEOUT_RECRUIT_SOLDIERS = 200;
beforeAll(() => {
  flux.setOption('displayLogs', false);

  const warcampStore = flux.addStore('warcamp2', {
    bridgeCrews: 24,
    soldiers: 11700,
  });

  warcampStore.register('warcamp2/addBridgeCrew', () => (state) => ({
    ...state,
    bridgeCrews: state.bridgeCrews + 1,
  }));

  warcampStore.register('warcamp2/fightForGemheart', () => void 0);

  warcampStore.register(
    'warcamp2/paySoldiers',
    async (dispatch, privatePay, officerPay, generalPay) => {
      // pretend to pay the soldiers, no state to update
      await new Promise((resolve) => setTimeout(resolve, TIMEOUT_PAY_SOLDIERS));
    },
  );

  warcampStore.register('warcamp2/recruitSoldiers', async () => {
    await new Promise((resolve) =>
      setTimeout(resolve, TIMEOUT_RECRUIT_SOLDIERS),
    );
    return (state) => ({
      ...state,
      soldiers: state.soldiers + 100,
    });
  });

  warcampStore.register('warcamp2/surrender', () => (state) => {
    throw new Error('We will never surrender!');
  });

  warcampStore.register('warcamp2/surrenderImmediately', () => {
    throw new Error('We will never surrender!');
  });
});

describe('flux', () => {
  describe('events', () => {
    test("that aren't in the system", () => {
      const status = flux.selectEvent('nonexistent/event');
      expect(status).toEqual({
        dispatched: false,
        dispatching: false,
        error: null,
        payload: [],
      });
    });

    test('that are in the system', () => {
      const status = flux.selectEvent('warcamp2/addBridgeCrew');
      expect(status).toEqual({
        dispatched: false,
        dispatching: false,
        error: null,
        payload: [],
      });
    });

    test('that are dispatching synchronously', async () => {
      function DynamicComponent() {
        const status = flux.useEvent('warcamp2/addBridgeCrew');
        return <span>{status.dispatching ? 'adding' : 'stable'}</span>;
      }

      render(<DynamicComponent />);
      expect(screen.getByText('stable')).toBeDefined();

      await act(() => flux.dispatch('warcamp2/addBridgeCrew'));
      expect(screen.queryByText('adding')).toBeNull();
      expect(screen.getByText('stable')).toBeDefined();

      // we need to add one more tick timeout into act because the event
      // status changes on the next tick, and the test will complain if we don't
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });

    test('that are dispatching asynchronously', async () => {
      function DynamicComponent() {
        const status = flux.useEvent('warcamp2/recruitSoldiers');
        return <span>{status.dispatching ? 'adding' : 'stable'}</span>;
      }

      render(<DynamicComponent />);
      expect(screen.queryByText('adding')).toBeNull();
      expect(screen.getByText('stable')).toBeDefined();

      await act(async () => {
        flux.dispatch('warcamp2/recruitSoldiers');
        await new Promise((resolve) =>
          setTimeout(resolve, TIMEOUT_RECRUIT_SOLDIERS / 2),
        );
      });
      expect(screen.queryByText('stable')).toBeNull();
      expect(screen.getByText('adding')).toBeDefined();

      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, TIMEOUT_RECRUIT_SOLDIERS / 2),
        );
      });
      expect(screen.queryByText('adding')).toBeNull();
      expect(screen.getByText('stable')).toBeDefined();

      // we need to add one more tick timeout into act because the event
      // status changes on the next tick, and the test will complain if we don't
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });

    test('that error during side-effects', async () => {
      let status = flux.selectEvent('warcamp2/surrenderImmediately');
      expect(status.error).toBe(null);

      flux.dispatch('warcamp2/surrenderImmediately');
      status = flux.selectEvent('warcamp2/surrenderImmediately');
      expect(status.error!.message).toBe('We will never surrender!');

      status = await flux.dispatch('warcamp2/surrenderImmediately');
      expect(status.error!.message).toBe('We will never surrender!');
    });

    test('that error during reduction', async () => {
      let status = flux.selectEvent('warcamp2/surrender');
      expect(status.error).toBe(null);

      flux.dispatch('warcamp2/surrender');
      status = flux.selectEvent('warcamp2/surrender');
      expect(status.error).toBe(null);

      await new Promise((resolve) => setTimeout(resolve, 0));
      status = flux.selectEvent('warcamp2/surrender');
      expect(status.error!.message).toBe('We will never surrender!');

      status = await flux.dispatch('warcamp2/surrender');
      expect(status.error!.message).toBe('We will never surrender!');
    });

    test('contain the latest payload information', async () => {
      await act(async () => {
        let status = flux.selectEvent('warcamp2/paySoldiers');
        expect(status.payload).toEqual([]);

        flux.dispatch('warcamp2/paySoldiers', 100, 500, 1000);
        status = flux.selectEvent('warcamp2/paySoldiers');
        expect(status.payload).toEqual([100, 500, 1000]);

        await new Promise((resolve) =>
          setTimeout(resolve, TIMEOUT_PAY_SOLDIERS),
        );
        status = flux.selectEvent('warcamp2/paySoldiers');
        expect(status.payload).toEqual([100, 500, 1000]);

        flux.dispatch('warcamp2/paySoldiers', 90, 450, 900);
        status = flux.selectEvent('warcamp2/paySoldiers');
        expect(status.payload).toEqual([90, 450, 900]);
      });
    });

    test('contain whether or not they were just dispatched', async () => {
      await act(async () => {
        let status = flux.selectEvent('warcamp2/fightForGemheart');
        expect(status.dispatched).toEqual(false);

        status = await flux.dispatch('warcamp2/fightForGemheart');
        expect(status.dispatched).toEqual(true);

        await new Promise((resolve) => setTimeout(resolve, 0));
        status = flux.selectEvent('warcamp2/fightForGemheart');
        expect(status.dispatched).toEqual(false);
      });
    });

    test('can be used to trigger side-effects in components', async () => {
      const sideEffect = jest.fn((privatePay, officerPay, generalPay) => {
        expect(privatePay).toEqual(100);
        expect(officerPay).toEqual(500);
        expect(generalPay).toEqual(1000);
      });

      function StaticComponent() {
        flux.useDispatchedEvent('warcamp2/paySoldiers', sideEffect);
        return null;
      }

      render(<StaticComponent />);

      await act(async () => {
        flux.dispatch('warcamp2/paySoldiers', 100, 500, 1000);
        await new Promise((resolve) =>
          setTimeout(resolve, TIMEOUT_PAY_SOLDIERS),
        );
      });

      expect(sideEffect).toHaveBeenCalled();
    });

    test('can be used to trigger side-effects when they finish resolving', async () => {
      const sideEffect = jest.fn(
        ({ payload: [privatePay, officerPay, generalPay] }) => {
          expect(privatePay).toEqual(100);
          expect(officerPay).toEqual(500);
          expect(generalPay).toEqual(1000);
        },
      );

      function StaticComponent() {
        flux.useResolvedEvent('warcamp2/paySoldiers', sideEffect);
        return null;
      }

      render(<StaticComponent />);

      await act(async () => {
        flux.dispatch('warcamp2/paySoldiers', 100, 500, 1000);
        await new Promise((resolve) =>
          setTimeout(resolve, TIMEOUT_PAY_SOLDIERS),
        );
      });

      expect(sideEffect).toHaveBeenCalled();

      // we need to add one more tick timeout into act because the event
      // status changes on the next tick, and the test will complain if we don't
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });
  });

  describe('useStore', () => {
    test('it works', async () => {
      function DynamicComponent() {
        const { followers } = flux.useStore(
          'diagram',
          {
            followers: 117,
          },
          {
            addFollowers: (dispatch, amount: number = 1) => (state) => ({
              ...state,
              followers: state.followers + amount,
            }),
          },
        );

        return <span>{followers}</span>;
      }

      render(<DynamicComponent />);
      expect(screen.getByText('117')).toBeDefined();

      await act(() => flux.dispatch('diagram/addFollowers', 10));
      expect(screen.queryByText('117')).toBeNull();
      expect(screen.getByText('127')).toBeDefined();
    });
  });

  describe('accessing stores', () => {
    test('directly', () => {
      expect(flux.warcamp2.selectState('bridgeCrews')).toBe(25);
    });

    test('by iteration', () => {
      for (const store of flux) {
        expect(
          store.namespace === 'diagram' || store.namespace === 'warcamp2',
        ).toBe(true);
      }

      for (const storeName in flux) {
        if (flux.hasOwnProperty(storeName)) {
          expect(storeName === 'diagram' || storeName === 'warcamp2').toBe(
            true,
          );
        }
      }
    });
  });
});
