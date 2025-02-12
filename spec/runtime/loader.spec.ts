import { expect } from "chai";
import * as path from "path";

import * as functions from "../../src/v1";
import * as loader from "../../src/runtime/loader";
import { ManifestEndpoint, ManifestRequiredAPI, ManifestStack } from "../../src/runtime/manifest";
import { clearParams } from "../../src/params";
import { MINIMAL_V1_ENDPOINT, MINIMAL_V2_ENDPOINT } from "../fixtures";
import { MINIMAL_SCHEDULE_TRIGGER, MINIMIAL_TASK_QUEUE_TRIGGER } from "../v1/providers/fixtures";

describe("extractStack", () => {
  const httpFn = functions.https.onRequest(() => undefined);
  const httpEndpoint = {
    platform: "gcfv1",
    httpsTrigger: {},
  };

  const callableFn = functions.https.onCall(() => undefined);
  const callableEndpoint = {
    platform: "gcfv1",
    labels: {}, // TODO: empty labels?
    callableTrigger: {},
  };

  it("extracts stack from a simple module", () => {
    const module = {
      http: httpFn,
      callable: callableFn,
    };

    const endpoints: Record<string, ManifestEndpoint> = {};
    const requiredAPIs: ManifestRequiredAPI[] = [];

    loader.extractStack(module, endpoints, requiredAPIs);

    expect(endpoints).to.be.deep.equal({
      http: {
        ...MINIMAL_V1_ENDPOINT,
        entryPoint: "http",
        ...httpEndpoint,
      },
      callable: {
        ...MINIMAL_V1_ENDPOINT,
        entryPoint: "callable",
        ...callableEndpoint,
      },
    });

    expect(requiredAPIs).to.be.empty;
  });

  it("extracts stack with required APIs", () => {
    const module = {
      taskq: functions.tasks.taskQueue().onDispatch(() => undefined),
    };

    const endpoints: Record<string, ManifestEndpoint> = {};
    const requiredAPIs: ManifestRequiredAPI[] = [];

    loader.extractStack(module, endpoints, requiredAPIs);

    expect(endpoints).to.be.deep.equal({
      taskq: {
        ...MINIMAL_V1_ENDPOINT,
        entryPoint: "taskq",
        platform: "gcfv1",
        taskQueueTrigger: MINIMIAL_TASK_QUEUE_TRIGGER,
      },
    });

    expect(requiredAPIs).to.be.deep.equal([
      {
        api: "cloudtasks.googleapis.com",
        reason: "Needed for task queue functions",
      },
    ]);
  });

  it("extracts stack from a module with group functions", () => {
    const module = {
      fn1: httpFn,
      g1: {
        fn2: httpFn,
      },
    };

    const endpoints: Record<string, ManifestEndpoint> = {};
    const requiredAPIs: ManifestRequiredAPI[] = [];

    loader.extractStack(module, endpoints, requiredAPIs);

    expect(endpoints).to.be.deep.equal({
      fn1: {
        ...MINIMAL_V1_ENDPOINT,
        entryPoint: "fn1",
        ...httpEndpoint,
      },
      "g1-fn2": {
        ...MINIMAL_V1_ENDPOINT,
        entryPoint: "g1.fn2",
        ...httpEndpoint,
      },
    });
  });

  describe("with GCLOUD_PROJECT env var", () => {
    const project = "my-project";
    let prev;

    beforeEach(() => {
      prev = process.env.GCLOUD_PROJECT;
      process.env.GCLOUD_PROJECT = project;
    });

    afterEach(() => {
      process.env.GCLOUD_PROJECT = prev;
      clearParams();
    });

    it("extracts stack from a simple module", () => {
      const module = {
        fn: functions.pubsub.topic("my-topic").onPublish(() => undefined),
      };

      const endpoints: Record<string, ManifestEndpoint> = {};
      const requiredAPIs: ManifestRequiredAPI[] = [];

      loader.extractStack(module, endpoints, requiredAPIs);

      expect(endpoints).to.be.deep.equal({
        fn: {
          ...MINIMAL_V1_ENDPOINT,
          entryPoint: "fn",
          platform: "gcfv1",
          eventTrigger: {
            eventType: "google.pubsub.topic.publish",
            eventFilters: {
              resource: "projects/my-project/topics/my-topic",
            },
            retry: false,
          },
          labels: {},
        },
      });
    });

    it("extracts stack with required APIs", () => {
      const module = {
        scheduled: functions.pubsub.schedule("every 5 minutes").onRun(() => undefined),
      };

      const endpoints: Record<string, ManifestEndpoint> = {};
      const requiredAPIs: ManifestRequiredAPI[] = [];

      loader.extractStack(module, endpoints, requiredAPIs);

      expect(endpoints).to.be.deep.equal({
        scheduled: {
          ...MINIMAL_V1_ENDPOINT,
          entryPoint: "scheduled",
          platform: "gcfv1",
          // TODO: This label should not exist?
          labels: {},
          scheduleTrigger: { ...MINIMAL_SCHEDULE_TRIGGER, schedule: "every 5 minutes" },
        },
      });

      expect(requiredAPIs).to.be.deep.equal([
        {
          api: "cloudscheduler.googleapis.com",
          reason: "Needed for scheduled functions.",
        },
      ]);
    });
  });
});

describe("mergedRequiredAPIs", () => {
  it("leaves required APIs unchanged if nothing to merge", () => {
    expect(
      loader.mergeRequiredAPIs([
        { api: "example1.com", reason: "example1" },
        { api: "example2.com", reason: "example2" },
      ])
    ).to.be.deep.equal([
      { api: "example1.com", reason: "example1" },
      { api: "example2.com", reason: "example2" },
    ]);
  });

  it("merges reasons given overlapping required api", () => {
    expect(
      loader.mergeRequiredAPIs([
        { api: "example1.com", reason: "example1a" },
        { api: "example1.com", reason: "example1b" },
        { api: "example2.com", reason: "example2" },
      ])
    ).to.be.deep.equal([
      { api: "example1.com", reason: "example1a example1b" },
      { api: "example2.com", reason: "example2" },
    ]);
  });

  it("merges reasons given overlapping required api", () => {
    expect(
      loader.mergeRequiredAPIs([
        { api: "example1.com", reason: "example1a" },
        { api: "example1.com", reason: "example1b" },
        { api: "example2.com", reason: "example2" },
      ])
    ).to.be.deep.equal([
      { api: "example1.com", reason: "example1a example1b" },
      { api: "example2.com", reason: "example2" },
    ]);
  });

  it("does not repeat the same reason", () => {
    expect(
      loader.mergeRequiredAPIs([
        { api: "example1.com", reason: "example1a" },
        { api: "example1.com", reason: "example1a" },
        { api: "example2.com", reason: "example2" },
      ])
    ).to.be.deep.equal([
      { api: "example1.com", reason: "example1a" },
      { api: "example2.com", reason: "example2" },
    ]);
  });
});

describe("loadStack", () => {
  const expected: ManifestStack = {
    endpoints: {
      v1http: {
        ...MINIMAL_V1_ENDPOINT,
        platform: "gcfv1",
        entryPoint: "v1http",
        httpsTrigger: {},
      },
      v1callable: {
        ...MINIMAL_V1_ENDPOINT,
        platform: "gcfv1",
        entryPoint: "v1callable",
        labels: {},
        callableTrigger: {},
      },
      v2http: {
        ...MINIMAL_V2_ENDPOINT,
        platform: "gcfv2",
        entryPoint: "v2http",
        labels: {},
        httpsTrigger: {},
      },
      v2callable: {
        ...MINIMAL_V2_ENDPOINT,
        platform: "gcfv2",
        entryPoint: "v2callable",
        labels: {},
        callableTrigger: {},
      },
    },
    requiredAPIs: [],
    specVersion: "v1alpha1",
  };

  interface Testcase {
    name: string;
    modulePath: string;
    expected: ManifestStack;
  }
  function runTests(tc: Testcase) {
    it("loads stack given relative path", async () => {
      await expect(loader.loadStack(tc.modulePath)).to.eventually.deep.equal(tc.expected);
    });

    it("loads stack given absolute path", async () => {
      await expect(
        loader.loadStack(path.join(process.cwd(), tc.modulePath))
      ).to.eventually.deep.equal(tc.expected);
    });
  }

  let prev;

  beforeEach(() => {
    // TODO: When __trigger annotation is removed and GCLOUD_PROJECT is not required at runtime, remove this.
    prev = process.env.GCLOUD_PROJECT;
    process.env.GCLOUD_PROJECT = "test-project";
  });

  afterEach(() => {
    process.env.GCLOUD_PROJECT = prev;
  });

  describe("commonjs", () => {
    const testcases: Testcase[] = [
      {
        name: "basic",
        modulePath: "./spec/fixtures/sources/commonjs",
        expected,
      },
      {
        name: "has main",
        modulePath: "./spec/fixtures/sources/commonjs-main",
        expected,
      },
      {
        name: "grouped",
        modulePath: "./spec/fixtures/sources/commonjs-grouped",
        expected: {
          ...expected,
          endpoints: {
            ...expected.endpoints,
            "g1-groupedhttp": {
              ...MINIMAL_V1_ENDPOINT,
              platform: "gcfv1",
              entryPoint: "g1.groupedhttp",
              httpsTrigger: {},
            },
            "g1-groupedcallable": {
              ...MINIMAL_V1_ENDPOINT,
              platform: "gcfv1",
              entryPoint: "g1.groupedcallable",
              labels: {},
              callableTrigger: {},
            },
          },
        },
      },
      {
        name: "has params",
        modulePath: "./spec/fixtures/sources/commonjs-params",
        expected: {
          ...expected,
          params: [
            { name: "BORING", type: "string" },
            {
              name: "FOO",
              type: "string",
              input: { text: { validationRegex: "w+" } },
            },
            {
              name: "BAR",
              type: "string",
              default: "{{ params.FOO }}",
              label: "asdf",
            },
            {
              name: "BAZ",
              type: "string",
              input: {
                select: { options: [{ value: "a" }, { value: "b" }] },
              },
            },
            { name: "AN_INT", type: "int", default: `{{ params.BAR == "qux" ? 0 : 1 }}` },
            {
              name: "ANOTHER_INT",
              type: "int",
              input: {
                select: {
                  options: [
                    { label: "a", value: -2 },
                    { label: "b", value: 2 },
                  ],
                },
              },
            },
            { name: "SUPER_SECRET_FLAG", type: "secret" },
          ],
        },
      },
    ];

    for (const tc of testcases) {
      describe(tc.name, () => {
        runTests(tc);
      });
    }
  });
});
