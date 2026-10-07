(function exposeOoFRVersion(scope) {
  const version = "1.0.0";
  scope.OOFR_VERSION = version;
  if (typeof module !== "undefined" && module.exports) module.exports = version;
})(typeof globalThis !== "undefined" ? globalThis : self);
