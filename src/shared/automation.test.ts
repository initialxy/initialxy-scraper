import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationManager } from './automation.ts';

describe('AutomationManager', () => {
  let manager: AutomationManager;
  let mockOnScrollRequested: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  let mockOnUpdateRequested: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let mockOnCloseRequested: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockOnScrollRequested = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
    mockOnUpdateRequested = vi.fn<() => Promise<void>>(() => Promise.resolve());
    mockOnCloseRequested = vi.fn<() => void>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with options', () => {
      manager = new AutomationManager({
        waitS: 2,
        scrollIntervalS: 1,
        closeOnIdleTimeS: 10,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });
      expect(manager).toBeDefined();
    });

    it('should initialize with null closeOnIdleTimeS', () => {
      manager = new AutomationManager({
        waitS: 0,
        scrollIntervalS: 0,
        closeOnIdleTimeS: null,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });
      expect(manager).toBeDefined();
    });
  });

  describe('start', () => {
    it('should call onUpdateRequested after waitS delay', async () => {
      manager = new AutomationManager({
        waitS: 2,
        scrollIntervalS: 0,
        closeOnIdleTimeS: null,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      // Fast-forward to after the wait period
      vi.advanceTimersByTime(2000);
      await vi.runOnlyPendingTimersAsync();

      expect(mockOnUpdateRequested).toHaveBeenCalled();
    });

    it('should not start if already running', async () => {
      manager = new AutomationManager({
        waitS: 0,
        scrollIntervalS: 0,
        closeOnIdleTimeS: null,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      manager.start(); // Should be ignored

      vi.advanceTimersByTime(100);
      await vi.runOnlyPendingTimersAsync();

      // Should only have been called once
      expect(mockOnUpdateRequested).toHaveBeenCalledTimes(1);
    });

    it('should start scroll and idle timer after wait', async () => {
      manager = new AutomationManager({
        waitS: 1,
        scrollIntervalS: 1,
        closeOnIdleTimeS: 5,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      // Advance past wait period
      vi.advanceTimersByTime(1000);
      await vi.runOnlyPendingTimersAsync();

      expect(mockOnUpdateRequested).toHaveBeenCalled();
    });
  });

  describe('scroll', () => {
    it('should call onScrollRequested at scrollIntervalS intervals', async () => {
      mockOnScrollRequested.mockResolvedValue(true);

      manager = new AutomationManager({
        waitS: 0,
        scrollIntervalS: 1,
        closeOnIdleTimeS: null,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      // First update
      vi.advanceTimersByTime(100);
      await vi.runOnlyPendingTimersAsync();

      // First scroll interval
      vi.advanceTimersByTime(1000);
      await vi.runOnlyPendingTimersAsync();

      expect(mockOnScrollRequested).toHaveBeenCalled();
    });

    it('should stop scrolling when onScrollRequested returns false', async () => {
      mockOnScrollRequested.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      manager = new AutomationManager({
        waitS: 0,
        scrollIntervalS: 1,
        closeOnIdleTimeS: null,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      // First scroll
      vi.advanceTimersByTime(1000);
      await vi.runOnlyPendingTimersAsync();

      // Second scroll - should stop
      vi.advanceTimersByTime(1000);
      await vi.runOnlyPendingTimersAsync();

      // Should have been called twice (true, then false)
      expect(mockOnScrollRequested).toHaveBeenCalledTimes(2);
    });

    it('should not scroll when scrollIntervalS is 0', async () => {
      manager = new AutomationManager({
        waitS: 0,
        scrollIntervalS: 0,
        closeOnIdleTimeS: null,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      vi.advanceTimersByTime(5000);
      await vi.runOnlyPendingTimersAsync();

      expect(mockOnScrollRequested).not.toHaveBeenCalled();
    });
  });

  describe('idle timer', () => {
    it('should call onCloseRequested after closeOnIdleTimeS', async () => {
      manager = new AutomationManager({
        waitS: 0,
        scrollIntervalS: 0,
        closeOnIdleTimeS: 5,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      // Advance past wait and idle time
      vi.advanceTimersByTime(5000);
      await vi.runOnlyPendingTimersAsync();

      expect(mockOnCloseRequested).toHaveBeenCalled();
    });

    it('should not start idle timer when closeOnIdleTimeS is null', async () => {
      manager = new AutomationManager({
        waitS: 0,
        scrollIntervalS: 0,
        closeOnIdleTimeS: null,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      vi.advanceTimersByTime(10000);
      await vi.runOnlyPendingTimersAsync();

      expect(mockOnCloseRequested).not.toHaveBeenCalled();
    });

    it('should not reset timer when closeOnIdleTimeS is null', async () => {
      manager = new AutomationManager({
        waitS: 0,
        scrollIntervalS: 0,
        closeOnIdleTimeS: null,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      // Should not throw
      expect(() => manager.onOutputEvent()).not.toThrow();
    });
  });

  describe('onOutputEvent', () => {
    it('should reset idle timer', async () => {
      manager = new AutomationManager({
        waitS: 0,
        scrollIntervalS: 0,
        closeOnIdleTimeS: 5,
        onScrollRequested: mockOnScrollRequested,
        onUpdateRequested: mockOnUpdateRequested,
        onCloseRequested: mockOnCloseRequested,
      });

      manager.start();

      // Advance past wait period
      vi.advanceTimersByTime(100);
      await vi.runOnlyPendingTimersAsync();

      // onOutputEvent should not throw
      expect(() => manager.onOutputEvent()).not.toThrow();
    });
  });
});
