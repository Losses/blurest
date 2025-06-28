import { AxBlurest } from './CustomElements.js';
/// <reference path="./cssExtendedProps.d.ts" />
/// <reference path="./cssTypedOM.d.ts" />

export function register() {
    customElements.define(AxBlurest.ElementName, AxBlurest);
}
