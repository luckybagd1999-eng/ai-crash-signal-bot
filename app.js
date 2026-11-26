
async function getHistory() {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await fetch(
      CONFIG.API + "/api/history",
      {
        headers: {"Accept":"application/json"},
        cache: "no-store",
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error("Erreur API HTTP " + response.status);
    }

    const data = await response.json();

    if (!Array.isArray(data.rounds)) {
      throw new Error("Format de données incorrect");
    }

    return data;

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Délai API dépassé : Render ne répond pas.");
    }
    throw error;

  } finally {
    clearTimeout(timeout);
  }
}
