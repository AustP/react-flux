import flux from '../src/flux';

const TIMEOUT_BUILD_BARRACKS = 400;
const TIMEOUT_FEED_SOLDIERS = 100;
const TIMEOUT_FIGHT_FOR_GEMHEART = 300;
const TIMEOUT_RECRUIT_SOLDIERS = 200;

const trueConsole = window.console;
beforeAll(() => {
  window.console = Object.create(trueConsole);

  window.console.groupCollapsed = jest.fn((...args) => args);
  window.console.groupEnd = jest.fn(() => void 0);
  window.console.log = jest.fn((...args) => args);
  window.console.warn = jest.fn((...args) => args);

  const warcampStore = flux.addStore('warcamp', {
    barracksBuilt: true,
    buildings: ['barracks'],
    bridgeCrews: 24,
    gemheartCaptured: false,
    soldiers: 11700,
    soldiersFed: false,
  });

  warcampStore.register('environment/newDay', () => (state) => ({
    ...state,
    gemheartCaptured: false,
    soldiersFed: false,
  }));

  warcampStore.register('warcamp/buildBarracks', async () => {
    await new Promise((resolve) => setTimeout(resolve, TIMEOUT_BUILD_BARRACKS));
    return (state) => ({
      ...state,
      barracksBuilt: true,
      buildings: [...state.buildings, 'barracks'],
    });
  });

  warcampStore.register('warcamp/celebrate', async (dispatch) => {
    // we need to wait for the music to start before we can eat
    await dispatch('warcamp/playMusic');

    // feed and pay the soldiers at the same time
    dispatch('warcamp/feedSoldiers');
    dispatch('warcamp/paySoldiers');
  });

  warcampStore.register('warcamp/feedSoldiers', async () => {
    await new Promise((resolve) => setTimeout(resolve, TIMEOUT_FEED_SOLDIERS));
    return (state) => ({ ...state, soldiersFed: true });
  });

  warcampStore.register('warcamp/fightForGemheart', async (dispatch) => {
    await new Promise((resolve) =>
      setTimeout(resolve, TIMEOUT_FIGHT_FOR_GEMHEART),
    );

    return (state) => {
      // after the state gets reduced, we will celebrate
      dispatch('warcamp/celebrate');

      return {
        ...state,
        gemheartCaptured: true,
      };
    };
  });

  warcampStore.register('warcamp/recruitSoldiers', async (dispatch) => {
    await new Promise((resolve) =>
      setTimeout(resolve, TIMEOUT_RECRUIT_SOLDIERS),
    );

    // don't await because we don't care when the barracks finishes
    dispatch('warcamp/buildBarracks');

    return (state) => ({
      ...state,
      barracksBuilt: false,
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

afterAll(() => {
  window.console = trueConsole;
});

describe('events', () => {
  describe('error handling', () => {
    test('it handles errors during side-effects', async () => {
      await flux.dispatch('warcamp/surrenderImmediately');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(flux.selectStatus('flux/error').payload[0]).toEqual(
        'warcamp/surrenderImmediately',
      );
      expect((flux.selectStatus('flux/error').error as Error).message).toEqual(
        'We will never surrender!',
      );
    });

    test('it handles errors during reduction', async () => {
      await flux.dispatch('warcamp/surrender');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(flux.selectStatus('flux/error').payload[0]).toEqual(
        'warcamp/surrender',
      );
      expect((flux.selectStatus('flux/error').error as Error).message).toEqual(
        'We will never surrender!',
      );
    });
  });

  describe('logging', () => {
    beforeEach(async () => {
      (window.console.groupCollapsed as jest.Mock).mockClear();
      (window.console.groupEnd as jest.Mock).mockClear();
      (window.console.log as jest.Mock).mockClear();
      (window.console.warn as jest.Mock).mockClear();
    });

    test('can be turned off', async () => {
      flux.setOption('displayLogs', false);

      await flux.dispatch('warcamp/feedSoldiers');
      expect((window.console.log as jest.Mock).mock.calls.length).toBe(0);

      flux.setOption('displayLogs', true);

      await flux.dispatch('warcamp/feedSoldiers');
      expect((window.console.log as jest.Mock).mock.calls.length).toBe(1);
    });

    test('warns when events take too long', async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, TIMEOUT_FEED_SOLDIERS * 2),
      );

      flux.setOption('longDispatchTimeout', TIMEOUT_FEED_SOLDIERS / 2);

      await flux.dispatch('warcamp/feedSoldiers');
      expect((window.console.warn as jest.Mock).mock.calls.length).toBe(1);

      flux.setOption('longDispatchTimeout', 5000);

      await flux.dispatch('warcamp/feedSoldiers');
      expect((window.console.warn as jest.Mock).mock.calls.length).toBe(1);
    });

    test('logs events hierarchically', async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, TIMEOUT_FEED_SOLDIERS * 4),
      );

      // warcamp/recruitSoldiers dispatches another event without awaiting
      // so even when this event is dispatched, the logging will be pending
      await flux.dispatch('warcamp/recruitSoldiers');
      expect(
        (window.console.groupCollapsed as jest.Mock).mock.calls.length,
      ).toBe(0);

      // after the warcamp/buildBarracks event is finished, that's when the
      // calls to the logging functions takes place
      await new Promise((resolve) =>
        setTimeout(resolve, TIMEOUT_BUILD_BARRACKS),
      );
      expect(
        (window.console.groupCollapsed as jest.Mock).mock.calls[0][0],
      ).toBe('warcamp/recruitSoldiers');
      expect(
        (window.console.groupCollapsed as jest.Mock).mock.calls[1][0],
      ).toBe('warcamp/buildBarracks');
      expect(
        (window.console.groupCollapsed as jest.Mock).mock.calls[2][1],
      ).toEqual({
        barracksBuilt: true,
        buildings: ['barracks'],
      });
      expect(
        (window.console.groupCollapsed as jest.Mock).mock.calls[3][1],
      ).toEqual({
        barracksBuilt: false,
        soldiers: 11800,
      });
    });
  });

  describe('reduction', () => {
    beforeEach(async () => {
      await flux.dispatch('environment/newDay');
    });

    test('it can be awaited for', async () => {
      await flux.dispatch('warcamp/feedSoldiers');
      expect(flux.warcamp!.selectState('soldiersFed')).toBe(true);
    });

    test('it happens after side-effects are awaited', async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, TIMEOUT_FEED_SOLDIERS),
      );

      flux.dispatch('warcamp/feedSoldiers');
      expect(flux.warcamp!.selectState('soldiersFed')).toBe(false);

      await new Promise((resolve) =>
        setTimeout(resolve, TIMEOUT_FEED_SOLDIERS),
      );
      expect(flux.warcamp!.selectState('soldiersFed')).toBe(true);
    });

    test('it happens before side-effects that are not awaited', async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, TIMEOUT_FEED_SOLDIERS * 2),
      );

      await flux.dispatch('warcamp/recruitSoldiers');
      expect(flux.warcamp!.selectState('barracksBuilt')).toBe(false);
      expect(flux.warcamp!.selectState('soldiers')).toBe(11900);
      expect(flux.selectStatus('warcamp/buildBarracks').dispatching).toBe(true);

      await new Promise((resolve) =>
        setTimeout(resolve, TIMEOUT_BUILD_BARRACKS),
      );
      expect(flux.warcamp!.selectState('barracksBuilt')).toBe(true);
      expect(flux.warcamp!.selectState('soldiers')).toBe(11900);
      expect(flux.selectStatus('warcamp/buildBarracks').dispatching).toBe(
        false,
      );
    });

    test('it happens before events are dispatched from reducers', async () => {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          TIMEOUT_FEED_SOLDIERS * 2 +
            TIMEOUT_RECRUIT_SOLDIERS +
            TIMEOUT_BUILD_BARRACKS,
        ),
      );

      await flux.dispatch('warcamp/fightForGemheart');
      expect(flux.warcamp!.selectState('gemheartCaptured')).toBe(true);
      expect(flux.selectStatus('warcamp/celebrate').dispatching).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(flux.selectStatus('warcamp/celebrate').dispatching).toBe(false);
      expect(flux.selectStatus('warcamp/feedSoldiers').dispatching).toBe(true);

      await new Promise((resolve) =>
        setTimeout(resolve, TIMEOUT_FEED_SOLDIERS),
      );
      expect(flux.selectStatus('warcamp/feedSoldiers').dispatching).toBe(false);
    });
  });
});
