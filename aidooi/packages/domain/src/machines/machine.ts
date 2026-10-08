import { IllegalTransition } from '../kernel/errors.ts';

/**
 * A state machine is data. The same definition drives application checks, the
 * `platform.state_transition` table that database triggers enforce, and the drift tests that
 * keep the two identical.
 */
export interface Machine<S extends string> {
  readonly name: string;
  readonly initial: S;
  readonly states: readonly S[];
  readonly transitions: { readonly [K in S]: readonly S[] };
}

export function defineMachine<const S extends string>(def: {
  name: string;
  initial: S;
  transitions: { readonly [K in S]: readonly S[] };
}): Machine<S> {
  const states = Object.keys(def.transitions) as S[];
  for (const [from, targets] of Object.entries(def.transitions) as [S, readonly S[]][]) {
    for (const to of targets) {
      if (!states.includes(to)) throw new Error(`${def.name}: ${from} → unknown state ${to}`);
    }
  }
  return { name: def.name, initial: def.initial, states, transitions: def.transitions };
}

export const canTransition = <S extends string>(m: Machine<S>, from: S, to: S): boolean =>
  from === to || m.transitions[from].includes(to);

export function assertTransition<S extends string>(m: Machine<S>, from: S, to: S): void {
  if (from !== to && !m.transitions[from].includes(to))
    throw new IllegalTransition(m.name, from, to);
}

/** Any machine, regardless of its state literal types — for tooling that treats them uniformly. */
export interface AnyMachine {
  readonly name: string;
  readonly initial: string;
  readonly states: readonly string[];
  readonly transitions: Readonly<Record<string, readonly string[]>>;
}

export const isTerminal = (m: AnyMachine, s: string): boolean =>
  (m.transitions[s] ?? []).length === 0;

/** Flat edge list, in the shape of `platform.state_transition`. */
export function edges(m: AnyMachine): { from: string; to: string }[] {
  return m.states.flatMap((from) => (m.transitions[from] ?? []).map((to) => ({ from, to })));
}
