/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @emails react-core
 */

'use strict';

var React;
var ReactNoop;
var ReactFeatureFlags;

describe('ReactIncrementalUpdates', () => {
  beforeEach(() => {
    jest.resetModuleRegistry();
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    ReactFeatureFlags = require('ReactFeatureFlags');
    ReactFeatureFlags.disableNewFiberFeatures = false;
  });

  function span(prop) {
    return {type: 'span', children: [], prop};
  }

  it('applies updates in order of priority', () => {
    let state;
    class Foo extends React.Component {
      state = {};
      componentDidMount() {
        ReactNoop.deferredUpdates(() => {
          // Has low priority
          this.setState({b: 'b'});
          this.setState({c: 'c'});
        });
        // Has Task priority
        this.setState({a: 'a'});
      }
      render() {
        state = this.state;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    ReactNoop.flushDeferredPri(25);
    expect(state).toEqual({a: 'a'});
    ReactNoop.flush();
    expect(state).toEqual({a: 'a', b: 'b', c: 'c'});
  });

  it('applies updates with equal priority in insertion order', () => {
    let state;
    class Foo extends React.Component {
      state = {};
      componentDidMount() {
        // All have Task priority
        this.setState({a: 'a'});
        this.setState({b: 'b'});
        this.setState({c: 'c'});
      }
      render() {
        state = this.state;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    ReactNoop.flush();
    expect(state).toEqual({a: 'a', b: 'b', c: 'c'});
  });

  it('only drops updates with equal or lesser priority when replaceState is called', () => {
    let instance;
    let ops = [];
    class Foo extends React.Component {
      state = {};
      componentDidMount() {
        ops.push('componentDidMount');
      }
      componentDidUpdate() {
        ops.push('componentDidUpdate');
      }
      render() {
        ops.push('render');
        instance = this;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    ReactNoop.flush();

    ReactNoop.flushSync(() => {
      ReactNoop.deferredUpdates(() => {
        instance.setState({x: 'x'});
        instance.setState({y: 'y'});
      });
      instance.setState({a: 'a'});
      instance.setState({b: 'b'});
      ReactNoop.deferredUpdates(() => {
        instance.updater.enqueueReplaceState(instance, {c: 'c'});
        instance.setState({d: 'd'});
      });
    });

    // Even though a replaceState has been already scheduled, it hasn't been
    // flushed yet because it has async priority.
    expect(instance.state).toEqual({a: 'a', b: 'b'});
    expect(ops).toEqual([
      'render',
      'componentDidMount',
      'render',
      'componentDidUpdate',
    ]);

    ops = [];

    ReactNoop.flush();
    // Now the rest of the updates are flushed, including the replaceState.
    expect(instance.state).toEqual({c: 'c', d: 'd'});
    expect(ops).toEqual(['render', 'componentDidUpdate']);
  });

  it('can abort an update, schedule additional updates, and resume', () => {
    let instance;
    class Foo extends React.Component {
      state = {};
      render() {
        instance = this;
        return <span prop={Object.keys(this.state).sort().join('')} />;
      }
    }

    ReactNoop.render(<Foo />);
    ReactNoop.flush();

    function createUpdate(letter) {
      return () => {
        ReactNoop.yield(letter);
        return {
          [letter]: letter,
        };
      };
    }

    // Schedule some async updates
    instance.setState(createUpdate('a'));
    instance.setState(createUpdate('b'));
    instance.setState(createUpdate('c'));

    // Begin the updates but don't flush them yet
    ReactNoop.flushThrough(['a', 'b', 'c']);
    expect(ReactNoop.getChildren()).toEqual([span('')]);

    // Schedule some more updates at different priorities{
    instance.setState(createUpdate('f'));
    ReactNoop.flushSync(() => {
      instance.setState(createUpdate('d'));
      instance.setState(createUpdate('e'));
    });
    instance.setState(createUpdate('g'));

    // The sync updates should have flushed, but not the async ones
    expect(ReactNoop.getChildren()).toEqual([span('de')]);

    // Now flush the remaining work. Updates a, b, and c should be processed
    // again, since they were interrupted last time.
    expect(ReactNoop.flush()).toEqual(['a', 'b', 'c', 'f', 'g']);
    expect(ReactNoop.getChildren()).toEqual([span('abcdefg')]);
  });

  it('can abort an update, schedule a replaceState, and resume', () => {
    let instance;
    class Foo extends React.Component {
      state = {};
      render() {
        instance = this;
        return <span prop={Object.keys(this.state).sort().join('')} />;
      }
    }

    ReactNoop.render(<Foo />);
    ReactNoop.flush();

    function createUpdate(letter) {
      return () => {
        ReactNoop.yield(letter);
        return {
          [letter]: letter,
        };
      };
    }

    // Schedule some async updates
    instance.setState(createUpdate('a'));
    instance.setState(createUpdate('b'));
    instance.setState(createUpdate('c'));

    // Begin the updates but don't flush them yet
    ReactNoop.flushThrough(['a', 'b', 'c']);
    expect(ReactNoop.getChildren()).toEqual([span('')]);

    // Schedule some more updates at different priorities{
    instance.setState(createUpdate('f'));
    ReactNoop.flushSync(() => {
      instance.setState(createUpdate('d'));
      // No longer a public API, but we can test that it works internally by
      // reaching into the updater.
      instance.updater.enqueueReplaceState(instance, createUpdate('e'));
    });
    instance.setState(createUpdate('g'));

    // The sync updates should have flushed, but not the async ones. Update d
    // was dropped and replaced by e.
    expect(ReactNoop.getChildren()).toEqual([span('e')]);

    // Now flush the remaining work. Updates a, b, and c should be processed
    // again, since they were interrupted last time.
    expect(ReactNoop.flush()).toEqual(['a', 'b', 'c', 'f', 'g']);
    expect(ReactNoop.getChildren()).toEqual([span('abcefg')]);
  });

  it('passes accumulation of previous updates to replaceState updater function', () => {
    let instance;
    class Foo extends React.Component {
      state = {};
      render() {
        instance = this;
        return <span />;
      }
    }
    ReactNoop.render(<Foo />);
    ReactNoop.flush();

    instance.setState({a: 'a'});
    instance.setState({b: 'b'});
    // No longer a public API, but we can test that it works internally by
    // reaching into the updater.
    instance.updater.enqueueReplaceState(instance, previousState => ({
      previousState,
    }));
    ReactNoop.flush();
    expect(instance.state).toEqual({previousState: {a: 'a', b: 'b'}});
  });

  it('does not call callbacks that are scheduled by another callback until a later commit', () => {
    let ops = [];
    class Foo extends React.Component {
      state = {};
      componentDidMount() {
        ops.push('did mount');
        this.setState({a: 'a'}, () => {
          ops.push('callback a');
          this.setState({b: 'b'}, () => {
            ops.push('callback b');
          });
        });
      }
      render() {
        ops.push('render');
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    ReactNoop.flush();
    expect(ops).toEqual([
      'render',
      'did mount',
      'render',
      'callback a',
      'render',
      'callback b',
    ]);
  });

  it('gives setState during reconciliation the same priority as whatever level is currently reconciling', () => {
    let instance;
    let ops = [];

    class Foo extends React.Component {
      state = {};
      componentWillReceiveProps() {
        ops.push('componentWillReceiveProps');
        this.setState({b: 'b'});
      }
      render() {
        ops.push('render');
        instance = this;
        return <div />;
      }
    }
    ReactNoop.render(<Foo />);
    ReactNoop.flush();

    ops = [];

    ReactNoop.flushSync(() => {
      instance.setState({a: 'a'});
      ReactNoop.render(<Foo />); // Trigger componentWillReceiveProps
    });

    expect(instance.state).toEqual({a: 'a', b: 'b'});
    expect(ops).toEqual(['componentWillReceiveProps', 'render']);
  });

  it('enqueues setState inside an updater function as if the in-progress update is progressed (and warns)', () => {
    spyOn(console, 'error');
    let instance;
    let ops = [];
    class Foo extends React.Component {
      state = {};
      render() {
        ops.push('render');
        instance = this;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    ReactNoop.flush();

    instance.setState(function a() {
      ops.push('setState updater');
      this.setState({b: 'b'});
      return {a: 'a'};
    });

    ReactNoop.flush();
    expect(ops).toEqual([
      // Initial render
      'render',
      'setState updater',
      // Update b is enqueued with the same priority as update a, so it should
      // be flushed in the same commit.
      'render',
    ]);
    expect(instance.state).toEqual({a: 'a', b: 'b'});

    expectDev(console.error.calls.count()).toBe(1);
    console.error.calls.reset();
  });
});
