import { h, render, Fragment, createContext, toChildArray } from 'preact';
import {
  useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useContext, useReducer
} from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export {
  h, render, Fragment, createContext, toChildArray,
  useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useContext, useReducer
};
