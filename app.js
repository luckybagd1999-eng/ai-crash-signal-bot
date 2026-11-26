
function analyseStrict(rounds) {
  if (rounds.length < 100) {
    return {
      valid: false,
      reason: "100 manches nécessaires"
    };
  }

  const all = rounds.map(r => r.multiplier);
  const recent = all.slice(-20);

  const median100 = median(all);
  const median20 = median(recent);
  const q25_20 = quantile(recent, 0.25);
  const q75_20 = quantile(recent, 0.75);

  const valid =
    median20 >= 2.00 &&
    q25_20 >= 2.00;

  return {
    valid,
    central: median20,
    low: q25_20,
    high: q75_20,
    median100,
    median20,
    q25_20
  };
}
