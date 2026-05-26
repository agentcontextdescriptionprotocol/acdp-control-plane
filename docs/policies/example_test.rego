# `opa test docs/policies/` runs all these.

package acdp.policy.v1

test_public_retrieve_anonymous_allowed if {
  decision == {"allow": true}
  with input as {
    "subject_did": "",
    "action": "context.retrieve",
    "resource_visibility": "public",
    "resource_audience": [],
    "scopes": [],
    "tenant_id": "default",
    "resource_id": "acdp://r/1",
  }
}

test_private_retrieve_anonymous_denied if {
  decision.allow == false
  decision.deny_code == "unauthenticated"
  with input as {
    "subject_did": "",
    "action": "context.retrieve",
    "resource_visibility": "private",
    "resource_audience": [],
    "scopes": [],
    "tenant_id": "default",
    "resource_id": "acdp://r/1",
  }
}

test_restricted_in_audience_allowed if {
  decision == {"allow": true}
  with input as {
    "subject_did": "did:web:alice",
    "action": "context.retrieve",
    "resource_visibility": "restricted",
    "resource_audience": ["did:web:bob", "did:web:alice"],
    "scopes": [],
    "tenant_id": "default",
    "resource_id": "acdp://r/1",
  }
}

test_restricted_not_in_audience_denied if {
  decision.allow == false
  decision.deny_code == "audience"
  with input as {
    "subject_did": "did:web:alice",
    "action": "context.retrieve",
    "resource_visibility": "restricted",
    "resource_audience": ["did:web:bob"],
    "scopes": [],
    "tenant_id": "default",
    "resource_id": "acdp://r/1",
  }
}

test_publish_authenticated_allowed if {
  decision == {"allow": true}
  with input as {
    "subject_did": "did:web:alice",
    "action": "context.publish",
    "resource_visibility": null,
    "resource_audience": [],
    "scopes": [],
    "tenant_id": "default",
    "resource_id": "",
  }
}

test_unknown_action_indeterminate if {
  decision.indeterminate == true
  with input as {
    "subject_did": "did:web:alice",
    "action": "context.weird",
    "resource_visibility": null,
    "resource_audience": [],
    "scopes": [],
    "tenant_id": "default",
    "resource_id": "",
  }
}
