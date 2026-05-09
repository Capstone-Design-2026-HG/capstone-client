chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "GET_RATINGS") {
    const { urls } = request;

    console.log("받은 URL:", urls);

    const ratings: Record<string, number> = {};

    urls.forEach((url: string) => {
      ratings[url] = (Math.random() * 5).toFixed(1) as unknown as number;
    });

    return true;
  }
});
