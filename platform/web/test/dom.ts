import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Component tests run in Node (so KB helpers can read files) with a DOM registered globally.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" });
