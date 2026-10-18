import { liveQuery } from "dexie";
import { type DependencyList, useEffect, useState } from "react";

// Re-runs the query whenever the data it read changes (in this tab or another).
// Returns undefined until the first result arrives.
export function useLive<T>(query: () => Promise<T>, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (result) => setValue(() => result),
      error: (error) => console.error("OoFR live query failed", error)
    });
    return () => subscription.unsubscribe();
  }, deps);
  return value;
}
