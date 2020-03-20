# AWS VPC clean up
This script is to clean up an existing AWS VPC at will

## Prerequisites:

- You need to have Docker on your machine
- You need to have a quay.io account
- You need to have a working AWS credentials

## Steps from your workstation

Login to quay.io

```bash
$ docker login quay.io
```

Get your VPC ID from AWS console 


Run this command:

```bash
$ docker run --rm -e AWS_SECRET_ACCESS_KEY="[YOUR AWS_SECRET_ACCESS_KEY]" -e AWS_ACCESS_KEY_ID="[YOUR AWS_ACCESS_KEY_ID]" -e AWS_REGION="[YOUR AWS_REGION]" quay.io/dnguyenv/aws-vpc-cleanup:0.0.1 "[YOUR AWS VPC ID]"
```

Example:

```bash
$ docker run --rm -e AWS_SECRET_ACCESS_KEY="Qre9+32rKQINzTzFhfFrxYVuTrBTLCcXNAxjDAZc" -e AWS_ACCESS_KEY_ID="WHOKNOWSWHATISTHIS" -e AWS_REGION="us-east-1" quay.io/dnguyenv/aws-vpc-cleanup:0.0.1 "vpc-0290b6ed86557f12f"
```

Peace! ;) 


