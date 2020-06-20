import { act, render, screen } from '@testing-library/react';
import React from 'react';

import flux, { Store } from '../src/flux';

declare global {
  interface Flux {
    warcamp: Store<{ bridgeCrews: number; soldiers: number }>;
  }
}

const TIMEOUT_PAY_SOLDIERS = 200;
const TIMEOUT_RECRUIT_SOLDIERS = 200;
beforeAll(() => {
  flux.setOption('displayLogs', false);

  const warcampStore = flux.addStore('warcamp', {
    bridgeCrews: 24,
    soldiers: 11700,
  });

  warcampStore.register('warcamp/addBridgeCrew', () => (state) => ({
    ...state,
    bridgeCrews: state.bridgeCrews + 1,
  }));

  warcampStore.register(
    'warcamp/paySoldiers',
    async (dispatch, privatePay, officerPay, generalPay) => {
      // pretend to pay the soldiers, no state to update
      await new Promise((resolve) => setTimeout(resolve, TIMEOUT_PAY_SOLDIERS));
    },
  );

  warcampStore.register('warcamp/recruitSoldiers', async () => {
    await new Promise((resolve) =>
      setTimeout(resolve, TIMEOUT_RECRUIT_SOLDIERS),
    );
    return (state) => ({
      ...state,
      soldiers: state.soldiers + 100,
    });
  });

  warcampStore.register('warcamp/surrender', () => (state) => {
    throw new Error('We will never surrender!');
  });

  warcampStore.register('warcamp/surrenderImmediately', () => {
    throw new Error('We will never surrender!');
  });
});

describe('flux', () => {
  describe('event statuses', () => {
    test("that aren't in the system", () => {
      const status = flux.selectStatus('nonexistent/event');
      expect(status).toEqual({
        dispatching: false,
        error: null,
        payload: [],
      });
    });

    test('that are in the system', () => {
      const status = flux.selectStatus('warcamp/addBridgeCrew');
      expect(status).toEqual({
        dispatching: false,
        error: null,
        payload: [],
      });
    });

    test('that are dispatching synchronously', async () => {
      function DynamicComponent() {
        const status = flux.useStatus('warcamp/addBridgeCrew');
        return <span>{status.dispatching ? 'adding' : 'stable'}</span>;
      }

      render(<DynamicComponent />);
      expect(screen.getByText('stable')).toBeDefined();

      await act(() => flux.dispatch('warcamp/addBridgeCrew'));
      expect(screen.queryByText('adding')).toBeNull();
      expect(screen.getByText('stable')).toBeDefined();
    });

    test('that are dispatching asynchronously', async () => {
      function DynamicComponent() {
        const status = flux.useStatus('warcamp/recruitSoldiers');
        return <span>{status.dispatching ? 'adding' : 'stable'}</span>;
      }

      render(<DynamicComponent />);
      expect(screen.queryByText('adding')).toBeNull();
      expect(screen.getByText('stable')).toBeDefined();

      await act(async () => {
        flux.dispatch('warcamp/recruitSoldiers');
        await new Promise((resolve) =>
          setTimeout(resolve, TIMEOUT_RECRUIT_SOLDIERS / 2),
        );
        expect(screen.queryByText('stable')).toBeNull();
        expect(screen.getByText('adding')).toBeDefined();

        await new Promise((resolve) =>
          setTimeout(resolve, TIMEOUT_RECRUIT_SOLDIERS / 2),
        );
        expect(screen.queryByText('adding')).toBeNull();
        expect(screen.getByText('stable')).toBeDefined();
      });
    });

    test('that error during side-effects', () => {
      act(() => {
        let status = flux.selectStatus('warcamp/surrenderImmediately');
        expect(status.error).toBe(null);

        flux.dispatch('warcamp/surrenderImmediately');
        status = flux.selectStatus('warcamp/surrenderImmediately');
        expect((status.error as Error).message).toBe(
          'We will never surrender!',
        );
      });
    });

    test('that error during reduction', async () => {
      await act(async () => {
        let status = flux.selectStatus('warcamp/surrender');
        expect(status.error).toBe(null);

        flux.dispatch('warcamp/surrender');
        status = flux.selectStatus('warcamp/surrender');
        expect(status.error).toBe(null);

        await new Promise((resolve) => setTimeout(resolve, 0));
        status = flux.selectStatus('warcamp/surrender');
        expect((status.error as Error).message).toBe(
          'We will never surrender!',
        );
      });
    });

    test('contain the latest payload information', async () => {
      await act(async () => {
        let status = flux.selectStatus('warcamp/paySoldiers');
        expect(status.payload).toEqual([]);

        flux.dispatch('warcamp/paySoldiers', 100, 500, 1000);
        status = flux.selectStatus('warcamp/paySoldiers');
        expect(status.payload).toEqual([100, 500, 1000]);

        await new Promise((resolve) =>
          setTimeout(resolve, TIMEOUT_PAY_SOLDIERS),
        );
        status = flux.selectStatus('warcamp/paySoldiers');
        expect(status.payload).toEqual([100, 500, 1000]);

        flux.dispatch('warcamp/paySoldiers', 90, 450, 900);
        status = flux.selectStatus('warcamp/paySoldiers');
        expect(status.payload).toEqual([90, 450, 900]);
      });
    });
  });

  describe('useStore', () => {
    test('it works', async () => {
      type DiagramState = {
        followers: number;
      };

      function DynamicComponent() {
        const { followers } = flux.useStore<DiagramState>(
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
      expect(flux.warcamp.selectState('bridgeCrews')).toBe(25);
    });

    test('by iteration', () => {
      for (const store of flux) {
        expect(
          store.namespace === 'diagram' || store.namespace === 'warcamp',
        ).toBe(true);
      }

      for (const storeName in flux) {
        if (flux.hasOwnProperty(storeName)) {
          expect(storeName === 'diagram' || storeName === 'warcamp').toBe(true);
        }
      }
    });
  });
});
