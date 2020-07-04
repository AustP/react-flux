import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import stateManager from '../src/stateManager';

describe('stateManager', () => {
  test('it allows the state to be initialized', () => {
    stateManager.init({
      bridgeNumber: 4,
      hero: 'Kaladin Stormblessed',
      location: 'Urithiru',
    });

    expect(stateManager.selectState('bridgeNumber')).toBe(4);
    expect(stateManager.selectState('hero')).toBe('Kaladin Stormblessed');
    expect(stateManager.selectState('location')).toBe('Urithiru');
  });

  describe('accessing the state', () => {
    test('from outside a component', () => {
      expect(stateManager.selectState('hero')).toBe('Kaladin Stormblessed');
    });

    test("from inside a component when the value doesn't need to stay up-to-date", () => {
      function StaticComponent() {
        const hero = stateManager.selectState<string>('hero');
        return <span>{hero}</span>;
      }

      render(<StaticComponent />);
      expect(screen.getByText('Kaladin Stormblessed')).toBeDefined();

      act(() => void stateManager.setState('hero', 'Dalinar Kohlin'));
      expect(screen.queryByText('Dalinar Kohlin')).toBeNull();
      expect(screen.getByText('Kaladin Stormblessed')).toBeDefined();
    });

    test('from inside a component when the value needs to stay up-to-date', () => {
      function DynamicComponent() {
        const hero = stateManager.useState<string>('hero')[0];
        return <span>{hero}</span>;
      }

      render(<DynamicComponent />);
      expect(screen.getByText('Dalinar Kohlin')).toBeDefined();

      act(() => void stateManager.setState('hero', 'Shallan Davar'));
      expect(screen.queryByText('Dalinar Kohlin')).toBeNull();
      expect(screen.getByText('Shallan Davar')).toBeDefined();
    });

    test('when the value is not in the manager', () => {
      expect(stateManager.selectState('villain')).toBeUndefined();
    });
  });

  describe('updating the state', () => {
    test('from outside a component', () => {
      stateManager.setState('hero', 'Jasnah Kohlin');
      expect(stateManager.selectState('hero')).toBe('Jasnah Kohlin');
    });

    test('from inside a component', () => {
      function DynamicComponent() {
        const [bridgeNumber, setBridgeNumber] = stateManager.useState<number>(
          'bridgeNumber',
        );

        return (
          <span onClick={() => setBridgeNumber(bridgeNumber + 1)}>
            Bridge {bridgeNumber}
          </span>
        );
      }

      render(<DynamicComponent />);
      expect(screen.getByText('Bridge 4')).toBeDefined();

      act(() => void fireEvent.click(screen.getByText('Bridge 4')));
      expect(screen.queryByText('Bridge 4')).toBeNull();
      expect(screen.getByText('Bridge 5')).toBeDefined();

      act(() => void fireEvent.click(screen.getByText('Bridge 5')));
      expect(screen.queryByText('Bridge 5')).toBeNull();
      expect(screen.getByText('Bridge 6')).toBeDefined();
    });

    test('when the value was previously undefined', () => {
      expect(stateManager.selectState('villain')).toBeUndefined();
      stateManager.setState('villain', 'Torol Sadeas');
      expect(stateManager.selectState('villain')).toBe('Torol Sadeas');
    });
  });
});
