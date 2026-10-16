"use client";
import React from "react";

export default function FilterChip({ filtersApplied, onClear }) {
  if (!filtersApplied) return null;

  const label =
    filtersApplied.label ||
    (filtersApplied.max_price
      ? `Under ${filtersApplied.max_price} rupees`
      : filtersApplied.min_price
      ? `Above ${filtersApplied.min_price} rupees`
      : "Filtered");

  return (
    <div className="filter-chip-container">
      <div className="filter-chip" role="status" aria-label={`Filter: ${label}`}>
        <span className="filter-chip__label">{label}</span>
        <button
          type="button"
          className="filter-chip__clear"
          onClick={onClear}
          aria-label="Clear filter"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
    </div>
  );
}
