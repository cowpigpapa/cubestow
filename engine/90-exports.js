// 공개 API(LoadwiseEngine)와 IIFE 끝.
  root.LoadwiseEngine = {
    ENGINE_VERSION,
    SAFETY_LEVELS,
    PREFERENCES,
    TRANSPORT_PROFILES,
    packShipment,
    allowedRotations,
    uniqueRotations,
    lateralSupportDirections,
    transportStabilityAssessment,
    transportReviews,
    lowerBound,
    _internal: {
      stackSafe,
      compareKeys,
      compact,
      supportInfo,
      evaluate,
      findPlacement,
      packContainer,
      createState,
      createWidthOracle,
      transportPlacementRisk,
      compressionSafe,
      finalizeLoad,
      preferenceKey,
      repairFromPrevious,
      prepareUnits
    }
  };
})(typeof self !== 'undefined' ? self : globalThis);
