import type { UserConfig } from "@commitlint/types";

const Configuration: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  ignores: [
    function ignoreDependabot(commit: string) {
      return commit.includes("<support@github.com>") && commit.includes("dependabot");
    },
  ],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "code-interpreter",
	"tools",
	"llms",
	"adapters",
	"serializer",
	"memory",
	"cache",
      ],
    ],
  },
};

export default Configuration;
