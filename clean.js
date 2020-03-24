#!/usr/bin/env node

const AWS = require('aws-sdk')
const Promise = require('bluebird')
const _ = require('lodash')
const yargs = require('yargs')
const bunyan = require('bunyan')

//let log

const efs = new AWS.EFS({ apiVersion: '2015-02-01', region: process.env.AWS_REGION })
const ec2 = new AWS.EC2({ apiVersion: '2016-11-15' })
const elb = new AWS.ELBv2({ apiVersion: '2015-12-01' });
const elbClassic = new AWS.ELB();

const yargsFunc = (yargs) => {
  yargs.positional('vpc-id', { describe: 'ID of the VPC', default: null })
}

yargs
  .command('delete [vpc-id]', 'Delete the VPC and all dependencies', yargsFunc, async (argv) => {
    const stream = argv.logToStdout ? process.stdout : process.stderr
    //log = bunyan.createLogger({ name: "delete-vpc", level: argv.logLevel, stream  })
    argv.dryRun = false;
    await deleteEC2Instances(argv.vpcId, argv.dryRun) // Remove EC2 Instances
    await deleteELBs(argv.vpcId, argv.dryRun) // Remove Load Balancers
    await deleteELBsClassic(argv.vpcId, argv.dryRun) // Remove Load Balancers - Classic type
    await deleteEFS(argv.vpcId, argv.dryRun) // Remove EFS volumes
    await deleteNATGateways(argv.vpcId, argv.dryRun) // Remove NAT Gateways
    await deleteNetworkInterfaces(argv.vpcId, argv.dryRun) // Remove Network Interfaces   
    await deleteSecurityGroups(argv.vpcId, argv.dryRun) // Remove Security Groups
    await deleteInternetGateways(argv.vpcId, argv.dryRun) // Remove Internet Gateways
    await deleteSubnets(argv.vpcId, argv.dryRun) // Delete subnets
    await deleteRouteTables(argv.vpcId, argv.dryRun) // Remove routables 
    await deleteVPCEndpoints(argv.vpcId, argv.dryRun) // Remove VPC endpoints
    await deleteVPC(argv.vpcId, argv.dryRun) // Remove VPC
    //await releaseEIPs(argv.vpcId, argv.dryRun) // Remove Instances
  })
  .option('log-level', { describe: 'Log level (debug, trace, info, warn, error)', default: 'info' })
  .option('log-to-stdout', { describe: 'Output logs to STDOUT instead of STDERR', default: true })
  .argv
/*
Release all EIPs ... 
*/
async function releaseEIPs(VpcId, DryRun) {
  console.log('Releasing EIPs instances .... ')
  const params = {
    Filters: [
      {
        Name: 'domain',
        Values: [ 'vpc' ]
      }]
  };
  const response = await Promise.fromCallback(cb => ec2.describeAddresses(params, cb))
  await Promise.map(response.Addresses, async (item) => {
        const allocationID = item.AllocationId
        const releaseParams = { DryRun, AllocationId:allocationID }
        return acm(ec2, 'releaseAddress', releaseParams, { allowedErrorCodes: ['OperationNotPermitted','InvalidAttachmentID.NotFound'], retryErrorCodes: ['AuthFailure','UnsupportedOperation','InvalidParameterValue','OperationalError'] })    
  })
}
  
async function deleteELBs(vpcId, DryRun) {
  console.log('Deleting ELBs non-classic instances .... ')
  const elbs = await Promise.fromCallback(cb => elb.describeLoadBalancers({}, cb))
  const elbsInVPC = elbs.LoadBalancers.filter(x => x.VpcId === vpcId)  
  
  return await Promise.map(elbsInVPC, async (elbInstance) => {
    const deleteParams = {
      LoadBalancerArn: elbInstance.LoadBalancerArn
    }
    
    if (DryRun) {
      return
    }
    return await acm(elb, 'deleteLoadBalancer', deleteParams)
  })
}

async function deleteEC2Instances(vpcId, DryRun) {
  console.log('Deleting EC2 instances .... ')
  const filterParams = {
    Filters: [
    {
      Name: 'vpc-id',
      Values: [ vpcId ]
    }]
  }
  const reservations = await Promise.fromCallback(cb => ec2.describeInstances(filterParams, cb))
  const instancesMap = reservations.Reservations.reduce((accumulator, current) => {
    current.Instances.forEach(i => { accumulator[i.InstanceId] = i })
    return accumulator
  }, {})
  const Ids = Object.keys(instancesMap)

  if (Ids.length === 0) {

    return []
  }
  const deleteParams = { InstanceIds:Ids, DryRun }

  return acm(ec2, 'terminateInstances', deleteParams)
}


async function deleteELBsClassic(vpcId, DryRun) {
  console.log('Deleting ELBs classic instances .... ')
  const elbs = await Promise.fromCallback(cb => elbClassic.describeLoadBalancers({}, cb))
  const elbsInVPC = elbs.LoadBalancerDescriptions.filter(x => x.VPCId === vpcId)  
  
  
  return await Promise.map(elbsInVPC, async (elbInstance) => {
    const deleteParams = {
      LoadBalancerName: elbInstance.LoadBalancerName
    }
    
    if (DryRun) {

      return
    }
    return await acm(elbClassic, 'deleteLoadBalancer', deleteParams)
  })
}


async function deleteVPCEndpoints(VpcId, DryRun) {
  console.log('Deleting VPC endpoint instances .... ')
  const params = {
    Filters: [
      {
        Name: 'vpc-id',
        Values: [ VpcId ]
      }]
  };
  const response = await Promise.fromCallback(cb => ec2.describeVpcEndpoints(params, cb))
  
  const endPointIds = response.VpcEndpoints.map(x => x.VpcEndpointId)
  
   await Promise.map(endPointIds, async (id) => {
    const params = { VpcEndpointIds:[id], DryRun };
    await acm(ec2, 'deleteVpcEndpoints', params)
  })

  return endPointIds
}

async function deleteInternetGateways(VpcId, DryRun) {
  console.log('Deleting IG instances .... ')
  const params = {
    Filters: [
      {
        Name: "attachment.vpc-id",
        Values: [ VpcId ]
      }
    ]
  };
  const response = await Promise.fromCallback(cb => ec2.describeInternetGateways(params, cb))
  const InternetGatewayIds = response.InternetGateways.map(x => x.InternetGatewayId)


  await Promise.map(InternetGatewayIds, async (id) => {
    const params = { InternetGatewayId:id, DryRun };
    const detachParams = Object.assign({}, params, { VpcId })
    await acm(ec2, 'detachInternetGateway', detachParams)
    await acm(ec2, 'deleteInternetGateway', params)
  })

  return InternetGatewayIds
}


async function deleteNATGateways(vpcId, DryRun) {
  console.log('Deleting NAT Gateways instances .... ')
  const params = {
    Filter: [
      {
        Name: "vpc-id",
        Values: [ vpcId ]
      }
    ]
  };
  const response = await Promise.fromCallback(cb => ec2.describeNatGateways(params, cb))
  const NatGatewayIds = response.NatGateways.map(x => x.NatGatewayId)

  return await Promise.map(NatGatewayIds, async (id) => {
    const params = { NatGatewayId:id };
    await acm(ec2, 'deleteNatGateway', params)
  })
}

async function getSubnetIds (vpcId) {
  const params = {
    Filters: [{
      Name: "vpc-id",
      Values: [ vpcId ]
    }]
  };
  const subnetResponse = await Promise.fromCallback(cb => ec2.describeSubnets(params, cb))
  return subnetResponse.Subnets.map(x => x.SubnetId)
}

async function deleteEFS (vpcId, DryRun) {
  console.log('Deleting EFS instances .... ')
  const response = await Promise.fromCallback(cb => efs.describeFileSystems({}, cb))
  const fileSystemIds = response.FileSystems.map(x => x.FileSystemId)

  const mountTargets = await Promise.reduce(fileSystemIds, async (memo, FileSystemId) => {
    const params = { FileSystemId }
    const response = await Promise.fromCallback(cb => efs.describeMountTargets(params, cb))
    return [].concat(memo).concat(response.MountTargets)
  }, [])
  const subnetIds = await getSubnetIds(vpcId)
  const mountTargetsToBeDeleted = mountTargets.filter(x => {
    return subnetIds.includes(x.SubnetId)
  })
  const fileSystemsToBeDeleted = _.uniq(mountTargetsToBeDeleted.map(x => x.FileSystemId))
  await Promise.map(mountTargetsToBeDeleted, async (mountTarget) => {
    const params = { MountTargetId: mountTarget.MountTargetId }
    return await acm(efs, 'deleteMountTarget', params)
  })
  await Promise.delay(3000)
  await Promise.map(fileSystemsToBeDeleted, async (FileSystemId) => {
    const params = { FileSystemId }
    return await acm(efs, 'deleteFileSystem', params, { retryErrorCodes: 'FileSystemInUse', retries: 10 })
  })
}

async function deleteSubnets (id, DryRun) {
  console.log('Deleting subnets instances .... ')
  const params = { VpcId: id, DryRun };
  const subnetIds = await getSubnetIds(id)
  await Promise.delay(3000)
  await Promise.map(subnetIds, async (SubId) => {
    const params = {SubnetId:SubId, DryRun}
    await acm(ec2, 'deleteSubnet', params, { retryErrorCodes: 'DependencyViolation' })
  })
}

async function deleteVPC (id, DryRun) {
  console.log('Finallay, deleting VPC instances .... ')
  const params = { VpcId: id, DryRun };
  await acm(ec2, 'deleteVpc', params, { allowedErrorCodes: 'InvalidVpcID.NotFound' })
}

async function deleteSecurityGroups (vpcId, DryRun) {
  var params = {
    DryRun,
    Filters: [{
      Name: 'vpc-id',
      Values: [ vpcId ]
    }]
  }
  const securityGroups = (await Promise.fromCallback(cb => ec2.describeSecurityGroups(params, cb))).SecurityGroups;
  await Promise.mapSeries(securityGroups, async (securityGroup) => {
    await Promise.mapSeries(securityGroup.IpPermissions, async (ruleUnfiltered) => {
      const rule = {}
      rule.GroupId = securityGroup.GroupId
      if (!_.isEmpty(ruleUnfiltered.IpRanges)) {
        const ipRange = ruleUnfiltered.IpRanges[0]
        rule.IpProtocol = ruleUnfiltered.IpProtocol
        rule.FromPort = ruleUnfiltered.FromPort
        rule.ToPort = ruleUnfiltered.ToPort
        rule.CidrIp = ipRange.CidrIp
      }
      if (!_.isEmpty(ruleUnfiltered.UserIdGroupPairs)) {
        rule.IpPermissions = [ _.pick(ruleUnfiltered, ['IpProtocol', 'UserIdGroupPairs', 'FromPort', 'ToPort']) ]
      }
      await acm(ec2, 'revokeSecurityGroupIngress', rule)
    })
    return
  })
  const sgIds = securityGroups.filter(x => x.GroupName !== 'default').map(x => x.GroupId)

  await Promise.delay(1000)
  await Promise.map(sgIds, async function (id) {
    const params = { GroupId:id, DryRun }
    return await acm(ec2, 'deleteSecurityGroup', params)
  })
}

async function deleteNetworkInterfaces (VpcId, DryRun) {
  const queryParams = {
    DryRun,
    Filters: [
      {
        Name: 'vpc-id',
        Values: [ VpcId ]
      }
    ]
  };
  const response = await Promise.fromCallback(cb => ec2.describeNetworkInterfaces(queryParams, cb))
  const networkInterfaceIds = response.NetworkInterfaces.map(x => x.NetworkInterfaceId)
  const networkInterfaceAttachmentIds = response.NetworkInterfaces.map(x => _.get(x, 'Attachment.AttachmentId')).filter(x => !!x)
  await Promise.map(networkInterfaceAttachmentIds, async (id) => {
    const detachParams = { AttachmentId:id, Force: true, DryRun }
    await acm(ec2, 'detachNetworkInterface', detachParams, { allowedErrorCodes: ['OperationNotPermitted','InvalidAttachmentID.NotFound'], retryErrorCodes: ['AuthFailure','UnsupportedOperation','InvalidParameterValue','OperationalError'] })
  })
  await Promise.map(networkInterfaceIds, async (id) => {
    const deleteParams = { DryRun, NetworkInterfaceId:id }
    return acm(ec2, 'deleteNetworkInterface', deleteParams, { allowedErrorCodes: 'InvalidNetworkInterfaceID.NotFound', retryErrorCodes: ['AuthFailure','UnsupportedOperation','InvalidParameterValue','OperationalError'] })
  })
}

async function deleteRouteTables (VpcId, DryRun) {
  const queryParams = {
    DryRun,
    Filters: [
      {
        Name: 'vpc-id',
        Values: [ VpcId ]
      },
    ]
  }
  const response = await Promise.fromCallback(cb => ec2.describeRouteTables(queryParams, cb))
  const routeTableIds = response.RouteTables.map(x => x.RouteTableId)
  return await Promise.map(routeTableIds, async (id) => {
    const query = { RouteTableId: id, DryRun }    
    return  acm(ec2, 'deleteRouteTable', query,{ allowedErrorCodes: 'DependencyViolation' } )
   })
}

/*
Core function 
*/
async function acm(classInstance, methodName, query, opts = {}) {
 // const className = classInstance.endpoint.host.split('.')[0]
  let response
  try {
    response = await Promise.fromCallback(cb => classInstance[methodName](query, cb))
  } catch (err) {
    if (opts.retryErrorCodes && opts.retryErrorCodes.includes(err.code)) {
      opts.retries = ((_.isNumber(opts.retries) ? opts.retries : 20) - 1)
      if (opts.retries <= 0) {

        return
      }

      await Promise.delay(opts.retryDelay || 5000)
      return acm(classInstance, methodName, query, opts)
    }
    if (opts.allowedErrorCodes && opts.allowedErrorCodes.includes(err.code)) {
      return 
    }
    if (opts.unHandledErrorCodes && opts.unHandledErrorCodes.includes(err.code)) {
      throw err
    }

    throw err
  }
  return response
}
