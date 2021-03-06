import { IInstance, IMoniker } from '@spinnaker/core';

export interface IKubernetesInstance extends IInstance {
  kind: string;
  name: string;
  humanReadableName: string;
  displayName: string;
  apiVersion: string;
  namespace: string;
  moniker: IMoniker;
}
