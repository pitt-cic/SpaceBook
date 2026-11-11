export interface RequestFormState {
  site: string;
  firstname: string;
  lastname: string;
  email: string;
  phone: string;
  org: string;
  title: string;
  activityType: string;
  type: string;
  date: string;
  start: string;
  end: string;
  room: string;
  altRoom1: string;
  altRoom2: string;
  attendance: string;
  setupTime: string;
  cleanupTime: string;
  techNeeds: string[];
  notes: string;
  minors: 'no' | 'yes' | 'maybe';
  minorsCompliance: boolean;
  facilityRulesAccepted: boolean;
  recurringEnabled: boolean;
  recurPattern: 'weekly' | 'biweekly' | 'monthly';
  recurDays: string[];
  recurStart: string;
  recurEndMode: 'date' | 'count';
  recurEndDate: string;
  recurCount: string;
}

export const INITIAL_REQUEST_FORM_STATE: RequestFormState = {
  site: '',
  firstname: '',
  lastname: '',
  email: '',
  phone: '',
  org: '',
  title: '',
  activityType: '',
  type: '',
  date: '',
  start: '',
  end: '',
  room: '',
  altRoom1: '',
  altRoom2: '',
  attendance: '',
  setupTime: 'None',
  cleanupTime: 'None',
  techNeeds: [],
  notes: '',
  minors: 'no',
  minorsCompliance: false,
  facilityRulesAccepted: false,
  recurringEnabled: false,
  recurPattern: 'weekly',
  recurDays: [],
  recurStart: '',
  recurEndMode: 'count',
  recurEndDate: '',
  recurCount: '4',
};
